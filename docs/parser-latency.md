# Voice parser latency on a local model

Supersedes branch `fix/local-llm-no-think` (commit 34f72a2). Same target
(Qwen3.5-4B on MLX, or any OpenAI-compatible server), different lever:
the cost was prompt prefill, not reasoning alone.

## Why the earlier fix fell short

- The Node OpenAI SDK has no `extra_body`. The `extra_body: { chat_template_kwargs }`
  spread was serialised as a nested JSON key that neither mlx_lm.server nor
  llama-server reads (both take `chat_template_kwargs` at the top level of
  the body). Thinking was never actually switched off.
- Even with thinking off, every capture re-processed ~4.6k prompt tokens.
  On a 4B model on Apple silicon prefill runs at a few hundred tokens/s, so
  prefill alone is 10–25 s; the answer itself is ~100 tokens, 2–3 s.
- Most of those tokens were row UUIDs (36 tokens each vs ~5 for a name)
  that the model never used: every `*_match` is resolved by name in
  `lib/match.ts`.

## What changed

`apps/api/src/lib/llm.ts`
- `effort: 'low'` sends `chat_template_kwargs: { enable_thinking: false, thinking: false }`
  at the top level of the body. medium/high leave the server default.
- Inline `<think>…</think>` blocks are stripped from content (servers with
  `reasoning_format none`); an unclosed block counts as no answer.
- `LlmResult.usage` carries prompt/cached/completion tokens and, from
  llama-server, prompt and generation milliseconds.
- `prefillPrompt()` sends a request with `max_tokens: 1` to load the prompt
  prefix into the server's KV cache (openai_compatible only).

`apps/api/src/lib/parser.ts`
- Context is names only: projects (with domain name), domains, people,
  in-progress content items. Sorted, compact JSON, byte-stable while the
  DB is unchanged.
- User message order: `<context>` (stable) → `<now>` → `<transcript>`, so
  the cached prefix covers system prompt + context and only the clock and
  transcript are new tokens.
- `warmParser(db)` sends system prompt + context through `prefillPrompt`,
  deduplicated for 20 s per context. Disambiguation candidates come back
  as labels and get their ids re-attached server-side.
- Every parse logs `parser llm call` with token counts, cache hits, and
  server timings.

`apps/api/src/routes/capture.ts`
- `POST /api/capture/warm` (202) — the web portal calls it when it opens
  or a recording starts.
- The audio route fires the warm-up before transcription, so prefill
  overlaps with STT.

## Verifying on the Mac mini

```bash
cd apps/api
BENCH_LLM_BASE_URL=http://127.0.0.1:8080/v1 BENCH_LLM_MODEL=mlx-community/Qwen3.5-4B-4bit \
  ./node_modules/.bin/tsx scripts/bench-parser.mts "add task to water the garden tomorrow"
```

Cold, then warmed, then a repeat. On a local llama-server (Qwen3.8-Flash-Next
IQ4_XS, prompt 2450 tokens incl. a 2238-token system prompt) the warmed
call reports `cachedPromptTokens: 2290`, prompt processing 0.4 s instead
of 3 s, total 2.8–4 s dominated by generation at ~35 tok/s. mlx_lm.server
has an LRU prompt cache with the same prefix reuse; its `usage` has no
timings, so watch `elapsed_ms` in the API log instead.

Remaining floor is generation speed × output length. Next levers if that
matters: a smaller/faster model for the parser only, or trimming the
2.2k-token system prompt (it is cached after the first call, so it only
costs once per server session).

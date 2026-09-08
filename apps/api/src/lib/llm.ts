import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { env } from './env.js';
import { getAppSettings } from './app-settings.js';

// Neutral chat-completion surface consumed by the voice parser and the chat
// tool loop. Two adapters:
//
//   openai_compatible (default) — any server speaking the OpenAI Chat
//     Completions API: llama.cpp (llama-server --jinja), MLX, Ollama, vLLM,
//     LM Studio… configured by base URL + model. This is the sovereign path.
//
//   anthropic — the cloud escape hatch, on the official @anthropic-ai/sdk
//     (adaptive thinking, effort, prompt caching). Flipping providers is a
//     pure config change; call sites never see provider types.
//
// Config resolution: app_settings row (dashboard-editable) → env fallback.
// getAppSettings() is cached and invalidated on PATCH, so a base-URL change
// in the browser applies to the next request without a restart.

export interface LlmToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface LlmToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type LlmMessage =
  | { role: 'user' | 'assistant'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls: LlmToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

/** Token accounting for a completion — what the parser logs so prompt
 *  size and cache hits are visible without a debugger. All optional:
 *  llama-server reports everything (via `timings`), mlx_lm.server only
 *  token counts, Anthropic counts plus cache reads. */
export interface LlmUsage {
  promptTokens?: number;
  /** Prompt tokens served from the server's prefix cache (not re-processed). */
  cachedPromptTokens?: number;
  completionTokens?: number;
  promptMs?: number;
  completionMs?: number;
}

export interface LlmResult {
  text: string;
  toolCalls: LlmToolCall[];
  usage?: LlmUsage;
}

export interface ChatCompleteOptions {
  system: string;
  messages: LlmMessage[];
  tools?: LlmToolDef[];
  /** Ask the model for a JSON object (OpenAI json_object mode / prompt contract on Anthropic). */
  jsonMode?: boolean;
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high';
}

interface ResolvedLlmConfig {
  provider: 'openai_compatible' | 'anthropic';
  baseUrl: string | null;
  model: string | null;
  apiKey: string | null;
}

async function resolveConfig(): Promise<ResolvedLlmConfig> {
  const s = await getAppSettings();
  const provider = s.llm_provider ?? env.LLM_PROVIDER;
  if (provider === 'anthropic') {
    return {
      provider,
      baseUrl: null,
      model: s.llm_model ?? env.ANTHROPIC_MODEL,
      apiKey: s.llm_api_key ?? env.ANTHROPIC_API_KEY ?? null,
    };
  }
  return {
    provider: 'openai_compatible',
    baseUrl: s.llm_base_url ?? env.LLM_BASE_URL ?? null,
    model: s.llm_model ?? env.LLM_MODEL ?? null,
    apiKey: s.llm_api_key ?? env.LLM_API_KEY ?? null,
  };
}

export async function isLlmConfigured(): Promise<boolean> {
  const cfg = await resolveConfig();
  if (cfg.provider === 'anthropic') return Boolean(cfg.apiKey);
  return Boolean(cfg.baseUrl && cfg.model);
}

/** Human-readable summary for healthz / integrations-status. Never leaks keys. */
export async function llmDescription(): Promise<string> {
  const cfg = await resolveConfig();
  if (cfg.provider === 'anthropic') {
    return cfg.apiKey ? `anthropic · ${cfg.model}` : 'anthropic · API key missing';
  }
  if (!cfg.baseUrl || !cfg.model) return 'openai_compatible · base URL/model not set';
  return `openai_compatible · ${cfg.baseUrl} · ${cfg.model}`;
}

// Clients are cheap to construct but cache by config so steady-state calls
// reuse connections. Keyed on the fields that change behavior.
let cachedOpenAi: { key: string; client: OpenAI } | null = null;
let cachedAnthropic: { key: string; client: Anthropic } | null = null;

function openAiClient(cfg: ResolvedLlmConfig): OpenAI {
  const key = `${cfg.baseUrl}|${cfg.apiKey ?? ''}`;
  if (cachedOpenAi?.key === key) return cachedOpenAi.client;
  const client = new OpenAI({
    baseURL: cfg.baseUrl!,
    // Local servers usually ignore the key but the SDK requires one.
    apiKey: cfg.apiKey ?? 'none',
  });
  cachedOpenAi = { key, client };
  return client;
}

function anthropicClient(cfg: ResolvedLlmConfig): Anthropic {
  const key = cfg.apiKey ?? '';
  if (cachedAnthropic?.key === key) return cachedAnthropic.client;
  const client = new Anthropic({ apiKey: key });
  cachedAnthropic = { key, client };
  return client;
}

// ─── OpenAI-compatible adapter ───────────────────────────────────────────

function toOpenAiMessages(system: string, messages: LlmMessage[]): OpenAI.ChatCompletionMessageParam[] {
  const out: OpenAI.ChatCompletionMessageParam[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    } else if (m.role === 'assistant' && 'toolCalls' in m && m.toolCalls.length > 0) {
      out.push({
        role: 'assistant',
        content: m.content ?? null,
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function' as const,
          function: { name: c.name, arguments: JSON.stringify(c.args) },
        })),
      });
    } else {
      out.push({ role: m.role, content: m.content ?? '' });
    }
  }
  return out;
}

// Hybrid-reasoning models (Qwen3 / Qwen3.5, GLM-4.x, DeepSeek V3.1…) reason
// at length by default. For a `low`-effort call — the voice parser, the
// illustration prompt, the connectivity ping — that reasoning is pure
// latency and, worse, can eat the whole max_tokens budget before any
// answer appears (finish_reason "length", empty content). The switch is
// the chat template's `enable_thinking` kwarg, passed as `chat_template_kwargs`
// — a TOP-LEVEL body field on llama-server (--jinja), mlx_lm.server, vLLM
// and SGLang. (The Node OpenAI SDK has no `extra_body`; anything nested
// under such a key never reaches the template.) Servers that don't know
// the field ignore it; templates that never read the kwarg are unaffected.
// Both spellings go out because templates disagree on the name.
// medium/high leave the server's default reasoning behaviour alone.
function openAiThinkingControls(effort: ChatCompleteOptions['effort']): Record<string, unknown> {
  if (effort === 'low') {
    return { chat_template_kwargs: { enable_thinking: false, thinking: false } };
  }
  return {};
}

function openAiBody(cfg: ResolvedLlmConfig, opts: ChatCompleteOptions): OpenAI.ChatCompletionCreateParamsNonStreaming {
  return {
    model: cfg.model!,
    max_tokens: opts.maxTokens ?? 2048,
    messages: toOpenAiMessages(opts.system, opts.messages),
    ...(opts.tools && opts.tools.length > 0
      ? {
          tools: opts.tools.map((t) => ({
            type: 'function' as const,
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
        }
      : {}),
    // json_object engages llama.cpp's JSON grammar; harmless on servers
    // that just prompt-steer.
    ...(opts.jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
    ...openAiThinkingControls(opts.effort),
  };
}

// Some servers return the reasoning inline (llama-server with
// --reasoning-format none, older builds, some proxies). Drop a leading
// <think>…</think> block so callers see only the answer. An unclosed block
// means the model ran out of budget mid-thought — there is no answer.
export function stripThinking(text: string): string {
  const t = text.replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, '');
  if (/^\s*<think>/i.test(t)) return '';
  // A template that pre-fills an empty think block can leave a bare closer.
  return t.replace(/^\s*<\/think>\s*/i, '').trim();
}

// llama-server adds a non-standard `timings` block and mirrors cache hits
// into usage.prompt_tokens_details; mlx_lm.server sends usage only.
function openAiUsage(res: OpenAI.ChatCompletion): LlmUsage | undefined {
  const usage = res.usage as
    | (OpenAI.CompletionUsage & { prompt_tokens_details?: { cached_tokens?: number } })
    | undefined;
  const timings = (res as { timings?: Record<string, number> }).timings;
  if (!usage && !timings) return undefined;
  return {
    promptTokens: usage?.prompt_tokens,
    cachedPromptTokens: timings?.cache_n ?? usage?.prompt_tokens_details?.cached_tokens,
    completionTokens: usage?.completion_tokens,
    promptMs: timings?.prompt_ms,
    completionMs: timings?.predicted_ms,
  };
}

async function completeOpenAi(cfg: ResolvedLlmConfig, opts: ChatCompleteOptions): Promise<LlmResult> {
  const client = openAiClient(cfg);
  const res = await client.chat.completions.create(openAiBody(cfg, opts));

  const choice = res.choices[0];
  const toolCalls: LlmToolCall[] = [];
  for (const call of choice?.message?.tool_calls ?? []) {
    if (call.type !== 'function') continue;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
    } catch {
      // Local models occasionally emit malformed JSON args — surface the
      // raw string so the tool handler / model can recover.
      args = { _raw: call.function.arguments };
    }
    toolCalls.push({ id: call.id, name: call.function.name, args });
  }
  return { text: stripThinking(choice?.message?.content ?? ''), toolCalls, usage: openAiUsage(res) };
}

// ─── Anthropic adapter ───────────────────────────────────────────────────

function toAnthropicMessages(messages: LlmMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  let pendingToolResults: Anthropic.ToolResultBlockParam[] = [];

  const flushToolResults = () => {
    if (pendingToolResults.length > 0) {
      out.push({ role: 'user', content: pendingToolResults });
      pendingToolResults = [];
    }
  };

  for (const m of messages) {
    if (m.role === 'tool') {
      // Consecutive tool results group into a single user turn — the
      // Messages API requires all results for one assistant turn together.
      pendingToolResults.push({
        type: 'tool_result',
        tool_use_id: m.toolCallId,
        content: m.content,
      });
      continue;
    }
    flushToolResults();
    if (m.role === 'assistant' && 'toolCalls' in m && m.toolCalls.length > 0) {
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const c of m.toolCalls) {
        blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args });
      }
      out.push({ role: 'assistant', content: blocks });
    } else {
      out.push({ role: m.role, content: m.content ?? '' });
    }
  }
  flushToolResults();
  return out;
}

async function completeAnthropic(cfg: ResolvedLlmConfig, opts: ChatCompleteOptions): Promise<LlmResult> {
  const client = anthropicClient(cfg);
  const res: Anthropic.Message = await client.messages.create({
    model: cfg.model!,
    max_tokens: opts.maxTokens ?? 2048,
    thinking: { type: 'adaptive' },
    output_config: { effort: opts.effort ?? 'medium' },
    system: [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }],
    ...(opts.tools && opts.tools.length > 0
      ? {
          tools: opts.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters as Anthropic.Tool['input_schema'],
          })),
        }
      : {}),
    messages: toAnthropicMessages(opts.messages),
  } as Anthropic.MessageCreateParamsNonStreaming);

  const toolCalls: LlmToolCall[] = res.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    .map((b) => ({ id: b.id, name: b.name, args: (b.input ?? {}) as Record<string, unknown> }));
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  const usage: LlmUsage = {
    promptTokens: res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0),
    cachedPromptTokens: res.usage.cache_read_input_tokens ?? undefined,
    completionTokens: res.usage.output_tokens,
  };
  return { text, toolCalls, usage };
}

// ─── Entry point ─────────────────────────────────────────────────────────

export async function chatComplete(opts: ChatCompleteOptions): Promise<LlmResult> {
  const cfg = await resolveConfig();
  if (cfg.provider === 'anthropic') {
    if (!cfg.apiKey) throw new Error('LLM provider is anthropic but no API key is configured.');
    return completeAnthropic(cfg, opts);
  }
  if (!cfg.baseUrl || !cfg.model) {
    throw new Error('LLM base URL/model not configured. Set them in Settings or via LLM_BASE_URL / LLM_MODEL.');
  }
  return completeOpenAi(cfg, opts);
}

/**
 * Prime a local server's prompt cache with a request's prefix, so the real
 * call that follows only has to process what comes after it.
 *
 * llama-server (cache_prompt, per slot) and mlx_lm.server (LRU prompt cache)
 * both reuse the KV cache of the longest previously seen token prefix, and
 * on a 4B-class model on Apple silicon prefill dominates latency — a few
 * thousand tokens of system prompt + context cost tens of seconds while the
 * answer itself takes one or two. Sending the prefix while the user is
 * still talking (or the audio is still with the STT server) hides that
 * cost entirely. `max_tokens: 1` keeps the request itself trivial.
 *
 * openai_compatible only: Anthropic caches via cache_control and a warm
 * request there would be a paid round-trip. Resolves to null when skipped.
 */
export async function prefillPrompt(opts: ChatCompleteOptions): Promise<LlmUsage | null> {
  const cfg = await resolveConfig();
  if (cfg.provider !== 'openai_compatible' || !cfg.baseUrl || !cfg.model) return null;
  const client = openAiClient(cfg);
  const res = await client.chat.completions.create(openAiBody(cfg, { ...opts, maxTokens: 1 }));
  return openAiUsage(res) ?? {};
}

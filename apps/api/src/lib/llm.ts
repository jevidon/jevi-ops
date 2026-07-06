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

export interface LlmResult {
  text: string;
  toolCalls: LlmToolCall[];
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

async function completeOpenAi(cfg: ResolvedLlmConfig, opts: ChatCompleteOptions): Promise<LlmResult> {
  const client = openAiClient(cfg);
  const res = await client.chat.completions.create({
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
  });

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
  return { text: choice?.message?.content?.trim() ?? '', toolCalls };
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
  return { text, toolCalls };
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

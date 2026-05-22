import Anthropic from '@anthropic-ai/sdk';
import { env } from './env.js';

// Lazy singleton — only instantiated when first used so the API can boot
// without ANTHROPIC_API_KEY set (voice routes will then return 503).

let _client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (_client) return _client;
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error(
      'Anthropic client requested but ANTHROPIC_API_KEY is not set. Add it to .env.',
    );
  }
  _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return _client;
}

export function isAnthropicConfigured(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

export function anthropicModel(): string {
  return env.ANTHROPIC_MODEL;
}

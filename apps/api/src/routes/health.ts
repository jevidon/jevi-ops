import type { FastifyPluginAsync } from 'fastify';
import { isSupabaseConfigured } from '../lib/supabase.js';
import { isAnthropicConfigured } from '../lib/anthropic.js';
import { isWhisperConfigured } from '../lib/whisper.js';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/healthz', async () => {
    return {
      status: 'ok',
      time: new Date().toISOString(),
      supabase_configured: isSupabaseConfigured(),
      anthropic_configured: isAnthropicConfigured(),
      whisper_configured: isWhisperConfigured(),
    };
  });

  app.get('/readyz', async (_req, reply) => {
    // Real readiness check will ping Supabase once the client is wired and
    // a project URL is set. For now: report what's configured.
    if (!isSupabaseConfigured()) {
      return reply.code(503).send({
        status: 'not_ready',
        reason: 'supabase_not_configured',
      });
    }
    return { status: 'ready' };
  });
};

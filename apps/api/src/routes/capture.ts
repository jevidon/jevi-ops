import type { FastifyPluginAsync } from 'fastify';
import { VoiceCaptureRequestSchema } from '@jerad-ops/shared/schemas';

// POST /api/capture/voice — accepts a transcript, will eventually return a
// structured list of actions parsed by Claude. Stubbed until ANTHROPIC_API_KEY
// is wired and the parser system prompt (spec §14) is implemented.

export const captureRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  app.post('/api/capture/voice', async (req, reply) => {
    const parsed = VoiceCaptureRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_payload',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    req.log.info(
      { user_id: req.user!.id, transcript: parsed.data.transcript },
      'voice transcript received',
    );

    return reply.code(202).send({
      status: 'pending_parser',
      transcript: parsed.data.transcript,
      note: 'Anthropic parser not yet wired. Set ANTHROPIC_API_KEY and implement the parser per spec §14.',
    });
  });
};

import type { FastifyReply, FastifyRequest } from 'fastify';
/** Run after requireAuth. Endpoint configuration and tests are owner actions. */
export async function requireOwnerSession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (req.authMethod !== 'session') reply.code(403).send({ error: 'owner_session_required' });
}

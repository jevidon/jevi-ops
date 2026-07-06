import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { verifySession } from '../lib/jwt.js';
import { getDb } from '../lib/db.js';
import { api_tokens } from '../db/schema.js';
import { hashApiToken } from '../routes/auth.js';

// Fastify plugin: verifies the Authorization bearer on protected routes.
// Two credential shapes:
//   * Session JWT — self-issued HS256, verified locally (no network).
//   * ops_… API token — named agent/device credential from api_tokens,
//     matched by SHA-256 hash, revocable, last_used_at touched async.
//
// Decorates req.user ({id, email}) and req.authMethod so routes that must
// be human-only (token management) can tell the two apart.

export interface AuthUser {
  id: string;
  email: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
    authMethod?: 'session' | 'api_token';
  }
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: import('fastify').FastifyReply) => Promise<void>;
  }
}

const authPlugin: FastifyPluginAsync = async (app) => {
  const requireAuth = async (req: FastifyRequest, reply: import('fastify').FastifyReply) => {
    const header = req.headers.authorization;
    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      return reply.code(401).send({ error: 'missing_bearer_token' });
    }
    const token = header.slice(7).trim();
    if (!token) {
      return reply.code(401).send({ error: 'missing_bearer_token' });
    }

    // Named API token (agents, edge devices).
    if (token.startsWith('ops_')) {
      const row = await getDb().query.api_tokens.findFirst({
        where: eq(api_tokens.token_hash, hashApiToken(token)),
      });
      if (!row || row.revoked_at) {
        req.log.warn('api token rejected');
        return reply.code(401).send({ error: 'invalid_token' });
      }
      // Touch last_used_at without blocking the request. Coarse (per
      // request) is fine — it's a "when was this credential last alive"
      // signal for the settings page, not an audit log.
      getDb()
        .update(api_tokens)
        .set({ last_used_at: new Date().toISOString() })
        .where(eq(api_tokens.id, row.id))
        .catch(() => {});
      req.user = { id: row.id, email: `token:${row.name}` };
      req.authMethod = 'api_token';
      return;
    }

    // Session JWT — local verification, no network round-trip.
    const claims = await verifySession(token);
    if (!claims) {
      req.log.warn('session token rejected');
      return reply.code(401).send({ error: 'invalid_token' });
    }
    req.user = { id: claims.sub, email: claims.email };
    req.authMethod = 'session';
  };

  app.decorate('requireAuth', requireAuth);
};

export default fp(authPlugin, { name: 'auth' });

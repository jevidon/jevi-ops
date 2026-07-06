import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { User } from '@supabase/supabase-js';
import { supabaseAdmin } from '../lib/supabase.js';

// Fastify plugin: verifies Bearer JWT on protected routes and decorates the
// request with the authenticated user. Data access goes through the shared
// Drizzle handle (lib/db.ts) — there is no per-request DB client.
//
// Phase A note: token verification still round-trips to Supabase Auth
// (auth.getUser). Phase B replaces this with local jose verification of
// self-issued tokens + api_tokens lookup.
//
// Usage on a route:
//   app.get('/api/tasks', { preHandler: app.requireAuth }, async (req) => {
//     ...getDb().query.tasks.findMany(...)
//   });

declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
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

    const { data, error } = await supabaseAdmin().auth.getUser(token);
    if (error || !data.user) {
      req.log.warn({ err: error?.message }, 'auth verification failed');
      return reply.code(401).send({ error: 'invalid_token' });
    }

    req.user = data.user;
  };

  app.decorate('requireAuth', requireAuth);
};

export default fp(authPlugin, { name: 'auth' });

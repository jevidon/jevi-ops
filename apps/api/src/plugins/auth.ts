import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { supabaseAdmin, supabaseFor } from '../lib/supabase.js';

// Fastify plugin: verifies Bearer JWT on protected routes and decorates the
// request with the authenticated user + a user-scoped Supabase client.
//
// Usage on a route:
//   app.get('/api/tasks', { preHandler: app.requireAuth }, async (req) => {
//     const { data } = await req.supabase.from('tasks').select('*');
//     return { tasks: data };
//   });

declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
    supabase?: SupabaseClient;
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

    // Verify the token via Supabase. The admin client is used only to call
    // auth.getUser(token) — RLS isn't relevant for that call.
    const { data, error } = await supabaseAdmin().auth.getUser(token);
    if (error || !data.user) {
      req.log.warn({ err: error?.message }, 'auth verification failed');
      return reply.code(401).send({ error: 'invalid_token' });
    }

    req.user = data.user;
    req.supabase = supabaseFor(token); // RLS applies for all queries on this client
  };

  app.decorate('requireAuth', requireAuth);
};

export default fp(authPlugin, { name: 'auth' });

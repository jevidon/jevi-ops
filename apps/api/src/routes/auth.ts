import type { FastifyPluginAsync } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../lib/db.js';
import { api_tokens, auth_user } from '../db/schema.js';
import { verifyPassword } from '../lib/passwords.js';
import { isAuthConfigured, signSession } from '../lib/jwt.js';

// /api/auth/* — self-issued auth for the single-user system.
//
//   POST /api/auth/login   { email, password } → { token, user }
//   GET  /api/auth/me      (requireAuth)       → { user }
//   POST /api/auth/tokens  (session only)      → create named agent/device token
//   GET  /api/auth/tokens  (session only)      → list tokens (no values)
//   DELETE /api/auth/tokens/:id (session only) → revoke
//
// The web app's sign-in server action calls login and stores the returned
// JWT in an HttpOnly cookie; the same token rides as a Bearer on API calls.

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(1024),
});

const CreateTokenSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['agent', 'device']).default('agent'),
});

// Tiny in-memory lockout: after MAX_FAILS failed logins, refuse attempts
// for LOCKOUT_MS. Single process, single user — a Map is plenty.
const MAX_FAILS = 5;
const LOCKOUT_MS = 60_000;
const failures = new Map<string, { count: number; lockedUntil: number }>();

export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/auth/login', async (req, reply) => {
    if (!isAuthConfigured()) {
      return reply.code(503).send({ error: 'auth_not_configured', reason: 'AUTH_SECRET not set' });
    }
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const { email, password } = parsed.data;

    const now = Date.now();
    const fail = failures.get(email);
    if (fail && fail.lockedUntil > now) {
      return reply.code(429).send({ error: 'too_many_attempts', retry_after_s: Math.ceil((fail.lockedUntil - now) / 1000) });
    }

    const user = await getDb().query.auth_user.findFirst({
      where: eq(auth_user.email, email),
    });
    const ok = user ? await verifyPassword(password, user.password_hash) : false;
    if (!user || !ok) {
      const next = { count: (fail?.count ?? 0) + 1, lockedUntil: 0 };
      if (next.count >= MAX_FAILS) {
        next.lockedUntil = now + LOCKOUT_MS;
        next.count = 0;
      }
      failures.set(email, next);
      req.log.warn({ email }, 'login failed');
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    failures.delete(email);

    const token = await signSession({ id: user.id, email: user.email });
    return reply.code(200).send({
      token,
      user: { id: user.id, email: user.email },
    });
  });

  app.get('/api/auth/me', { preHandler: app.requireAuth }, async (req) => {
    return { user: { id: req.user!.id, email: req.user!.email } };
  });

  // ─── Agent / device tokens ─────────────────────────────────────────────
  //
  // Session-authenticated only: a token can't mint or revoke tokens. The
  // requireSession gate distinguishes the human's JWT from an ops_ token
  // (see plugins/auth.ts — req.authMethod).

  const requireSession = async (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => {
    await app.requireAuth(req, reply);
    if (reply.sent) return;
    if (req.authMethod !== 'session') {
      return reply.code(403).send({ error: 'session_required', reason: 'API tokens cannot manage tokens.' });
    }
  };

  app.post('/api/auth/tokens', { preHandler: requireSession }, async (req, reply) => {
    const parsed = CreateTokenSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    // ops_ prefix makes tokens greppable and lets the auth plugin route
    // them without attempting JWT parsing.
    const value = `ops_${randomBytes(32).toString('base64url')}`;
    const [row] = await getDb()
      .insert(api_tokens)
      .values({
        name: parsed.data.name,
        kind: parsed.data.kind,
        token_hash: hashApiToken(value),
      })
      .returning({ id: api_tokens.id, name: api_tokens.name, kind: api_tokens.kind, created_at: api_tokens.created_at });
    if (!row) throw app.httpErrors.internalServerError('insert_returned_no_row');
    // The token value is returned exactly once. Only the hash is stored.
    return reply.code(201).send({ ...row, token: value });
  });

  app.get('/api/auth/tokens', { preHandler: requireSession }, async () => {
    const rows = await getDb().query.api_tokens.findMany({
      columns: { id: true, name: true, kind: true, created_at: true, last_used_at: true, revoked_at: true },
      orderBy: desc(api_tokens.created_at),
    });
    return { tokens: rows };
  });

  app.delete<{ Params: { id: string } }>('/api/auth/tokens/:id', { preHandler: requireSession }, async (req, reply) => {
    const [row] = await getDb()
      .update(api_tokens)
      .set({ revoked_at: new Date().toISOString() })
      .where(eq(api_tokens.id, req.params.id))
      .returning({ id: api_tokens.id });
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return reply.code(200).send({ revoked: row.id });
  });
};

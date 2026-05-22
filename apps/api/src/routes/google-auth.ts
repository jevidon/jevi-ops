import type { FastifyPluginAsync } from 'fastify';
import { randomBytes } from 'node:crypto';
import { env, isDev } from '../lib/env.js';
import {
  isGoogleConfigured,
  oauth2Client,
  saveTokens,
  clearTokens,
  loadTokens,
  GOOGLE_SCOPES,
} from '../lib/google.js';
import { verifyOAuthBridgeToken } from '../lib/oauth-bridge.js';

// Google OAuth flow:
//   1. User on web clicks "Connect Google Calendar" → a server action mints
//      a short-lived HMAC-signed bridge token (apps/web/.../google-actions.ts).
//   2. Browser is redirected to GET /api/auth/google?t=<token>. The token
//      proves the request came from an authenticated Supabase session;
//      without it, the endpoint refuses to start the flow. We then redirect
//      the browser to Google with a random `state` cookie (CSRF for the
//      callback leg).
//   3. Google sends user back to /api/auth/google/callback with code + state.
//   4. We verify state, exchange code → tokens, persist, redirect back to
//      the web app's /settings?google=connected page.

const STATE_COOKIE = 'google_oauth_state';

export const googleAuthRoutes: FastifyPluginAsync = async (app) => {
  // Status endpoint — surfaced on the web Settings page. Auth-gated.
  app.get('/api/auth/google/status', { preHandler: app.requireAuth }, async () => {
    const tokens = await loadTokens();
    return {
      configured: isGoogleConfigured(),
      connected: Boolean(tokens),
      last_synced_at: tokens?.last_synced_at ?? null,
      scope: tokens?.scope ?? null,
    };
  });

  // Begin — initiates the consent flow.
  //
  // Gate: requires a valid bridge token (HMAC-signed by the web app using
  // OAUTH_BRIDGE_SECRET) in the `t` query param. The web settings page mints
  // this from a server action that has access to the Supabase session.
  //
  // In dev, if OAUTH_BRIDGE_SECRET isn't set we fall back to open access so
  // localhost flows still work without configuration. In production the
  // secret is required.
  app.get<{ Querystring: { t?: string } }>('/api/auth/google', async (req, reply) => {
    if (!isGoogleConfigured()) {
      return reply.code(503).send({
        error: 'google_oauth_not_configured',
        reason: 'Set GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET in .env.',
      });
    }

    const secret = env.OAUTH_BRIDGE_SECRET;
    if (!secret) {
      if (!isDev) {
        req.log.warn('oauth begin called without OAUTH_BRIDGE_SECRET configured');
        return reply.code(503).send({
          error: 'oauth_bridge_not_configured',
          reason: 'OAUTH_BRIDGE_SECRET is required in production.',
        });
      }
      // Dev fallback — proceed without verification.
    } else {
      const token = req.query.t;
      if (!token) {
        return reply.code(401).send({ error: 'missing_bridge_token' });
      }
      const result = verifyOAuthBridgeToken(token, secret);
      if (!result.ok) {
        req.log.warn({ reason: result.reason }, 'oauth bridge token rejected');
        return reply.code(401).send({ error: 'bad_bridge_token', reason: result.reason });
      }
      // Token is valid. We don't have a multi-user model yet (Google tokens
      // live in a singleton row), so the user_id isn't used downstream —
      // but accepting it signals intent for multi-user later. Log for audit.
      req.log.info({ user_id: result.claims.user_id }, 'oauth begin authenticated via bridge');
    }

    const state = randomBytes(16).toString('hex');
    reply.setCookie(STATE_COOKIE, state, {
      path: '/api/auth/google',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 600, // 10 minutes
    });

    const url = oauth2Client().generateAuthUrl({
      access_type: 'offline', // request refresh_token
      prompt: 'consent',      // force re-prompt so we always get a refresh_token
      scope: GOOGLE_SCOPES,
      state,
    });
    return reply.redirect(url, 302);
  });

  // Callback — Google redirects here with code + state.
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/api/auth/google/callback',
    async (req, reply) => {
      const { code, state, error } = req.query;
      const webUrl = env.WEB_APP_URL;

      if (error) {
        return reply.redirect(`${webUrl}/settings?google=error&reason=${encodeURIComponent(error)}`, 302);
      }
      if (!code || !state) {
        return reply.redirect(`${webUrl}/settings?google=error&reason=missing_code_or_state`, 302);
      }

      const cookieState = req.cookies?.[STATE_COOKIE];
      reply.clearCookie(STATE_COOKIE, { path: '/api/auth/google' });
      if (!cookieState || cookieState !== state) {
        return reply.redirect(`${webUrl}/settings?google=error&reason=state_mismatch`, 302);
      }

      try {
        const client = oauth2Client();
        const { tokens } = await client.getToken(code);
        await saveTokens(tokens);
      } catch (err) {
        req.log.error({ err }, 'token exchange failed');
        return reply.redirect(`${webUrl}/settings?google=error&reason=token_exchange_failed`, 302);
      }

      return reply.redirect(`${webUrl}/settings?google=connected`, 302);
    },
  );

  // Disconnect — wipes tokens.
  app.post('/api/auth/google/disconnect', { preHandler: app.requireAuth }, async (_req, reply) => {
    await clearTokens();
    return reply.code(200).send({ status: 'disconnected' });
  });
};

import type { FastifyPluginAsync } from 'fastify';
import { randomBytes } from 'node:crypto';
import { env } from '../lib/env.js';
import {
  isGoogleConfigured,
  oauth2Client,
  saveTokens,
  clearTokens,
  loadTokens,
  GOOGLE_SCOPES,
} from '../lib/google.js';

// Google OAuth flow:
//   1. User on web clicks "Connect Google Calendar".
//   2. Browser hits GET /api/auth/google → we redirect to Google with a
//      random `state` saved in a short-lived cookie (CSRF).
//   3. Google sends user back to /api/auth/google/callback with code + state.
//   4. We verify state, exchange code → tokens, persist, redirect back to
//      the web app's /settings?google=connected page.
//
// The user *is* the auth context — we use requireAuth on the begin endpoint
// so an attacker can't initiate a connect flow on Jerad's behalf.

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
  // Intentionally NOT auth-gated: this is a `<a href>` navigation, so the
  // browser doesn't send the Authorization header. CSRF protection comes
  // from the state cookie below — but a malicious site that lures Jerad
  // into navigating here could still trick him into completing a flow that
  // stores their tokens in his DB. Acceptable on localhost (only Jerad can
  // reach the API). TODO before public exposure: bridge the Supabase
  // session cookie across the web+API origin or move the begin step to a
  // web Route Handler.
  app.get('/api/auth/google', async (req, reply) => {
    if (!isGoogleConfigured()) {
      return reply.code(503).send({
        error: 'google_oauth_not_configured',
        reason: 'Set GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET in .env.',
      });
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

import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import sensible from '@fastify/sensible';
import { env, corsOrigins, isDev } from './lib/env.js';
import { startScheduler } from './lib/scheduler.js';
import authPlugin from './plugins/auth.js';
import { healthzRoutes } from './routes/healthz.js';
import { authRoutes } from './routes/auth.js';
import { ingestRoutes } from './routes/ingest.js';
import { taskRoutes } from './routes/tasks.js';
import { projectRoutes } from './routes/projects.js';
import { domainRoutes } from './routes/domains.js';
import { captureRoutes } from './routes/capture.js';
import { googleAuthRoutes } from './routes/google-auth.js';
import { calendarRoutes } from './routes/calendar.js';
import { chatRoutes } from './routes/chat.js';
import { notificationRoutes } from './routes/notifications.js';
import { observationRoutes } from './routes/observations.js';
import { attentionRoutes } from './routes/attention.js';
import { focusRoutes } from './routes/focus.js';
import { cronRoutes } from './routes/cron.js';
import { settingsRoutes } from './routes/settings.js';
import { healthRoutes } from './routes/health.js';
import { libraryRoutes } from './routes/library.js';
import { contentRoutes } from './routes/content.js';
import { searchRoutes } from './routes/search.js';
import { peopleRoutes } from './routes/people.js';
import { routineRoutes } from './routes/routines.js';
import { uploadRoutes } from './routes/uploads.js';
import { briefingRoutes } from './routes/briefing.js';
import { widgetRoutes } from './routes/widget.js';
import { immichRoutes } from './routes/immich.js';

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport: isDev
        ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' } }
        : undefined,
    },
    trustProxy: true,
    disableRequestLogging: false,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: corsOrigins.length === 1 && corsOrigins[0] === '*' ? true : corsOrigins,
    credentials: true,
  });
  await app.register(sensible);
  await app.register(cookie);
  await app.register(multipart, {
    // Whisper's max upload is 25 MB. Cap matches.
    limits: { fileSize: 25 * 1024 * 1024 },
  });
  await app.register(authPlugin);

  // Serve stored image attachments. Files are written by lib/storage.ts
  // under UPLOADS_DIR; URLs on attachment records point here.
  if (env.UPLOADS_DIR) {
    await app.register(fastifyStatic, {
      root: env.UPLOADS_DIR,
      prefix: '/uploads/',
      decorateReply: false,
    });
  }

  // Global error handler. Route handlers use plain awaits — thrown errors
  // land here. @fastify/sensible httpErrors carry statusCode and pass
  // through; everything else is a 500. postgres.js errors carry a SQLSTATE
  // in .code — surfaced for debuggability (single-user app, no tenant
  // leakage concern).
  app.setErrorHandler((err: Error & { statusCode?: number; code?: string; name?: string }, req, reply) => {
    const statusCode = typeof err.statusCode === 'number' && err.statusCode >= 400 ? err.statusCode : 500;
    if (statusCode >= 500) {
      req.log.error({ err }, 'request failed');
    }
    const pgCode = err.code;
    return reply.code(statusCode).send({
      error: statusCode >= 500 ? 'internal_error' : (err.name ?? 'error'),
      message: err.message,
      ...(pgCode && /^[0-9A-Z]{5}$/.test(pgCode) ? { code: pgCode } : {}),
    });
  });

  await app.register(healthzRoutes);
  await app.register(authRoutes);
  await app.register(ingestRoutes);
  await app.register(taskRoutes);
  await app.register(projectRoutes);
  await app.register(domainRoutes);
  await app.register(captureRoutes);
  await app.register(googleAuthRoutes);
  await app.register(calendarRoutes);
  await app.register(chatRoutes);
  await app.register(notificationRoutes);
  await app.register(observationRoutes);
  await app.register(attentionRoutes);
  await app.register(focusRoutes);
  await app.register(cronRoutes);
  await app.register(libraryRoutes);
  await app.register(contentRoutes);
  await app.register(searchRoutes);
  await app.register(peopleRoutes);
  await app.register(routineRoutes);
  await app.register(uploadRoutes);
  await app.register(settingsRoutes);
  await app.register(healthRoutes);
  await app.register(briefingRoutes);
  await app.register(widgetRoutes);
  await app.register(immichRoutes);

  app.get('/', async () => ({
    name: 'jevi-ops/api',
    version: '0.1.0',
    docs: 'See README.md',
  }));

  if (env.CRON_ENABLED) {
    const stopScheduler = await startScheduler(app.log);
    app.addHook('onClose', async () => stopScheduler());
  }

  return app;
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const app = await buildServer();
  try {
    await app.listen({ host: env.API_HOST, port: env.API_PORT });
  } catch (err) {
    app.log.fatal(err);
    process.exit(1);
  }
}

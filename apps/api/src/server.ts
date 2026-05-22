import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import sensible from '@fastify/sensible';
import { env, corsOrigins, isDev } from './lib/env.js';
import authPlugin from './plugins/auth.js';
import { healthRoutes } from './routes/health.js';
import { ingestRoutes } from './routes/ingest.js';
import { taskRoutes } from './routes/tasks.js';
import { projectRoutes } from './routes/projects.js';
import { domainRoutes } from './routes/domains.js';
import { captureRoutes } from './routes/capture.js';

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
  await app.register(multipart, {
    // Whisper's max upload is 25 MB. Cap matches.
    limits: { fileSize: 25 * 1024 * 1024 },
  });
  await app.register(authPlugin);

  await app.register(healthRoutes);
  await app.register(ingestRoutes);
  await app.register(taskRoutes);
  await app.register(projectRoutes);
  await app.register(domainRoutes);
  await app.register(captureRoutes);

  app.get('/', async () => ({
    name: 'jerad-ops/api',
    version: '0.1.0',
    docs: 'See README.md',
  }));

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

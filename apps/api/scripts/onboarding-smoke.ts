/** Isolated local acceptance environment; never starts against the owner's DB. */
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import postgres from 'postgres';
import { env } from '../src/lib/env.js';
import { hashPassword } from '../src/lib/passwords.js';
import { signSession } from '../src/lib/jwt.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const directory = resolve(root, '.dev-run/onboarding-smoke');
const statePath = resolve(directory, 'state.json');
type State = { database: string; database_url: string; auth_secret: string; owner_id: string; token: string; api_pid?: number; web_pid?: number };
const apiPort = 3301, webPort = 3300;
const url = new URL(env.DATABASE_URL ?? '');
if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname) || url.port !== '54329') throw new Error('Smoke setup requires local development Postgres on port 54329.');
const readState = async () => JSON.parse(await readFile(statePath, 'utf8')) as State;
const saveState = async (state: State) => writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
const alive = (pid?: number) => { try { if (!pid) return false; process.kill(pid, 0); return true; } catch { return false; } };

async function setup() {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try { await readFile(statePath); throw new Error('Smoke state exists. Reuse it or run cleanup before creating another database.'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const database = `jeviops_onboarding_smoke_${randomBytes(4).toString('hex')}`;
  const admin = postgres(url.toString(), { max: 1, onnotice() {} });
  try { await admin.unsafe(`create database ${database}`); } finally { await admin.end(); }
  const target = new URL(url); target.pathname = `/${database}`;
  const state: State = { database, database_url: target.toString(), auth_secret: randomBytes(32).toString('hex'), owner_id: randomUUID(), token: '' };
  const db = postgres(state.database_url, { max: 1, onnotice() {} });
  try {
    await db.file(resolve(root, 'infrastructure/schema-selfhost.sql'));
    await db.file(resolve(root, 'infrastructure/seed.sql'));
    await db`create table schema_migrations (filename text primary key, applied_at timestamptz not null default now())`;
    for (const filename of (await readdir(resolve(root, 'infrastructure/migrations'))).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort()) {
      await db`insert into schema_migrations(filename) values (${filename})`;
    }
    await db`update app_settings set timezone='Pacific/Auckland', currency='NZD' where id=true`;
    const passwordHash = await hashPassword('jevi-local-smoke-test-only');
    await db`insert into auth_user(id,email,password_hash) values (${state.owner_id},'onboarding-smoke@example.test',${passwordHash})`;
    env.AUTH_SECRET = state.auth_secret;
    state.token = await signSession({ id: state.owner_id, email: 'onboarding-smoke@example.test' });
    await saveState(state);
    console.log(JSON.stringify({ database, owner_email: 'onboarding-smoke@example.test', web: `http://onboarding.localhost:${webPort}`, api: `http://127.0.0.1:${apiPort}` }));
  } finally { await db.end(); }
}
async function runApi() {
  const state = await readState();
  Object.assign(env, { DATABASE_URL: state.database_url, AUTH_SECRET: state.auth_secret, API_HOST: '127.0.0.1', API_PORT: apiPort,
    API_PUBLIC_URL: `http://127.0.0.1:${apiPort}`, WEB_APP_URL: `http://onboarding.localhost:${webPort}`, CRON_ENABLED: false, LOG_LEVEL: 'warn', UPLOADS_DIR: resolve(directory, 'photos') });
  process.env.PRIVATE_SOURCES_DIR = resolve(directory, 'private');
  await mkdir(env.UPLOADS_DIR!, { recursive: true });
  const { buildServer } = await import('../src/server.js');
  const server = await buildServer();
  await server.listen({ host: '127.0.0.1', port: apiPort });
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void server.close().finally(() => process.exit(0)); });
}
async function start() {
  const state = await readState();
  for (const [name, port] of [['api', apiPort], ['web', webPort]] as const) {
    if (alive(state[`${name}_pid`])) continue;
    try { await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) }); throw new Error(`Port ${port} is already occupied.`); }
    catch (error) { if ((error as Error).message.includes('already occupied')) throw error; }
    const log = await open(resolve(directory, `${name}.log`), 'a', 0o600);
    const args = name === 'api' ? [resolve(root, 'apps/api/node_modules/.bin/tsx'), fileURLToPath(import.meta.url), 'run-api'] :
      [resolve(root, 'apps/web/node_modules/.bin/next'), 'dev', '-H', '127.0.0.1', '-p', String(webPort)];
    const child = spawn(args[0]!, args.slice(1), { cwd: resolve(root, name === 'api' ? 'apps/api' : 'apps/web'), detached: true, stdio: ['ignore', log.fd, log.fd],
      env: { ...process.env, AUTH_SECRET: state.auth_secret, API_URL: `http://127.0.0.1:${apiPort}`, API_PUBLIC_URL: `http://127.0.0.1:${apiPort}`, WEB_APP_URL: `http://onboarding.localhost:${webPort}`, JEVI_NEXT_DIST_DIR: '.next-smoke', NODE_ENV: 'development' } });
    child.unref(); await log.close(); state[`${name}_pid`] = child.pid;
  }
  await saveState(state);
  console.log(JSON.stringify({ api_pid: state.api_pid, web_pid: state.web_pid, web: `http://onboarding.localhost:${webPort}` }));
}
async function stop() {
  const state = await readState();
  for (const pid of [state.web_pid, state.api_pid]) if (alive(pid)) process.kill(-pid!, 'SIGTERM');
  delete state.api_pid; delete state.web_pid; await saveState(state);
}
async function cleanup() {
  const state = await readState();
  if (!/^jeviops_onboarding_smoke_[0-9a-f]{8}$/.test(state.database)) throw new Error('Refusing unexpected database name.');
  await stop();
  const admin = postgres(url.toString(), { max: 1, onnotice() {} });
  try { await admin.unsafe(`drop database ${state.database} with (force)`); } finally { await admin.end(); }
  await rm(directory, { recursive: true, force: true });
  console.log('Disposable onboarding smoke environment removed.');
}
const command = process.argv[2];
if (command === 'setup') await setup();
else if (command === 'start') await start();
else if (command === 'run-api') await runApi();
else if (command === 'stop') await stop();
else if (command === 'cleanup') await cleanup();
else if (command === 'status') { const state = await readState(); console.log({ database: state.database, api: alive(state.api_pid), web: alive(state.web_pid) }); }
else throw new Error('Usage: tsx scripts/onboarding-smoke.ts setup|start|status|stop|cleanup');

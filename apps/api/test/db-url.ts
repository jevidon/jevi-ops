import { env } from '../src/lib/env.js';

// The test database is the dev DATABASE_URL with its database name swapped
// for jeviops_test — same container, same credentials, separate data.
export const TEST_DB_NAME = 'jeviops_test';

export function devUrl(): string {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set — the tests need the dev Postgres (docker compose)');
  const target = new URL(env.DATABASE_URL);
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(target.hostname) || target.port !== '54329') {
    throw new Error('Integration tests require the local disposable development Postgres on port 54329; refusing database creation/drop on another host.');
  }
  return env.DATABASE_URL;
}

export function testUrl(): string {
  const u = new URL(devUrl());
  u.pathname = `/${TEST_DB_NAME}`;
  return u.toString();
}

// Admin connection: the dev database itself (we only need CREATE DATABASE).
export function adminUrl(): string {
  return devUrl();
}

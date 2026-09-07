import { env } from '../src/lib/env.js';

// The test database is the dev DATABASE_URL with its database name swapped
// for jeviops_test — same container, same credentials, separate data.
export const TEST_DB_NAME = 'jeviops_test';

export function devUrl(): string {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set — the tests need the dev Postgres (docker compose)');
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

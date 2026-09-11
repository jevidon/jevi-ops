import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { TEST_DB_NAME, adminUrl, testUrl } from './db-url.js';

// Rebuild jeviops_test from scratch once per run: drop, create, load the
// full schema + seed (which creates the Inbox system domain and the
// app_settings row the code depends on). schema-selfhost.sql always matches
// the branch's migration set, so no migration replay is needed.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export default async function globalSetup(): Promise<void> {
  const admin = postgres(adminUrl(), { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`drop database if exists ${TEST_DB_NAME} with (force)`);
    await admin.unsafe(`create database ${TEST_DB_NAME}`);
  } finally {
    await admin.end();
  }

  const test = postgres(testUrl(), { max: 1, onnotice: () => {} });
  try {
    await test.file(resolve(ROOT, 'infrastructure/schema-selfhost.sql'));
    await test.file(resolve(ROOT, 'infrastructure/seed.sql'));
    await test.file(resolve(ROOT, 'apps/api/test/fixtures/domains.sql'));
  } finally {
    await test.end();
  }
}

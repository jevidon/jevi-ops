import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// Drizzle is wired but the schema TS file isn't generated yet — that comes
// after a hosted Supabase project exists and we can introspect it (or after
// we hand-author drizzle schemas mirroring the SQL migrations).

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  verbose: true,
  strict: true,
});

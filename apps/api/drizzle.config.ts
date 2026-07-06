import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// Introspection config. The generated schema lives at src/db/schema.ts and
// is "generated-then-owned": `pnpm --filter @jevi-ops/api exec drizzle-kit pull`
// regenerated it once from a database running infrastructure/schema-selfhost.sql,
// then it was hand-curated (jsonb $type<>(), relation names). Re-pulling is
// NOT routine — schema changes go into schema-selfhost.sql AND schema.ts.
//
// introspect.casing 'snake_case' is load-bearing: generated property names
// stay identical to the snake_case column names, so route JSON responses keep
// the field names (due_date, not dueDate) the web app expects.

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './src/db',
  introspect: { casing: 'snake_case' },
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://jevi:jevi@localhost:54329/jeviops',
  },
  verbose: true,
  strict: true,
});

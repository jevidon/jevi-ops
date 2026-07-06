import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.js';
import * as relations from '../db/relations.js';
import { env } from './env.js';

// Single Drizzle client for the whole API. Lazy singleton so the server can
// boot without DATABASE_URL (healthz stays up; data routes 503 via
// isDatabaseConfigured checks).
//
// The custom type parsers are load-bearing: they reproduce the wire shapes
// PostgREST (supabase-js) used to return, which the web app was built
// against —
//   numeric      → JSON number            (postgres.js default: string)
//   timestamptz  → ISO-8601 'T…Z' string  (postgres.js default: Date)
//   timestamp    → ISO-8601 'T…Z' string  (naive; interpreted as UTC)
//   date         → 'yyyy-mm-dd' passthrough
// Drizzle columns are declared numeric({mode:'number'}) / timestamp({mode:
// 'string'}) to match, so both raw sql`` and the query builder agree.

const fullSchema = { ...schema, ...relations };

let _sql: postgres.Sql | null = null;
let _db: ReturnType<typeof buildDb> | null = null;

function buildDb(client: postgres.Sql) {
  return drizzle(client, { schema: fullSchema });
}

export function sqlClient(): postgres.Sql {
  if (_sql) return _sql;
  if (!env.DATABASE_URL) {
    throw new Error(
      'Database client requested but DATABASE_URL is not set. Add it to .env (see .env.example).',
    );
  }
  _sql = postgres(env.DATABASE_URL, {
    max: 10,
    onnotice: () => {},
    types: {
      numeric: {
        to: 1700,
        from: [1700],
        serialize: (v: number | string) => String(v),
        parse: (v: string) => Number(v),
      },
      timestamptz: {
        to: 1184,
        from: [1184],
        serialize: (v: string) => v,
        parse: (v: string) => new Date(v).toISOString(),
      },
      timestamp: {
        to: 1114,
        from: [1114],
        serialize: (v: string) => v,
        parse: (v: string) => new Date(v + 'Z').toISOString(),
      },
      date: {
        to: 1082,
        from: [1082],
        serialize: (v: string) => v,
        parse: (v: string) => v,
      },
    },
  });
  return _sql;
}

export function getDb() {
  if (_db) return _db;
  const client = sqlClient();
  _db = buildDb(client);
  // drizzle's postgres-js driver overwrites the date/timestamp parsers with
  // identity functions at construction (drizzle-orm/postgres-js/driver.js),
  // which would surface Postgres text format ('2026-07-06 19:10:36+00') to
  // API consumers. Re-install our PostgREST-shape parsers afterwards so
  // every read path — query builder and raw sql`` alike — returns ISO-T
  // strings and 'yyyy-mm-dd' dates.
  const opts = (client as unknown as { options: { parsers: Record<number, (v: string) => unknown> } }).options;
  opts.parsers[1184] = (v: string) => new Date(v).toISOString();          // timestamptz
  opts.parsers[1114] = (v: string) => new Date(v + 'Z').toISOString();    // timestamp (naive → UTC)
  opts.parsers[1082] = (v: string) => v;                                  // date passthrough
  return _db;
}

/** The Drizzle database handle type — background libs take this as a param. */
export type Db = ReturnType<typeof getDb>;

export function isDatabaseConfigured(): boolean {
  return Boolean(env.DATABASE_URL);
}

/** Close the pool (tests / graceful shutdown). */
export async function closeDb(): Promise<void> {
  if (_sql) {
    await _sql.end({ timeout: 5 });
    _sql = null;
    _db = null;
  }
}

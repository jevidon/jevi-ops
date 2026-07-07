#!/usr/bin/env node
// Row-count parity check between two Postgres databases — the Supabase
// source and the NAS target during the MIGRATION.md cutover.
//
//   node scripts/verify-migration.mjs \
//     --source 'postgresql://…supabase…:5432/postgres' \
//     --target 'postgresql://jevi:…@nas:5432/jeviops'
//
// Compares count(*) for every public-schema table that exists on BOTH
// sides (fork-only tables like auth_user/api_tokens are reported as
// target-only, not failures). Exits 1 on any mismatch.

import postgres from 'postgres';

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const sourceUrl = arg('--source') ?? process.env.SOURCE_URL;
const targetUrl = arg('--target') ?? process.env.TARGET_URL;
if (!sourceUrl || !targetUrl) {
  console.error('Usage: verify-migration.mjs --source <pg url> --target <pg url>');
  process.exit(1);
}

const TABLES_SQL = `
  select table_name from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'
  order by table_name
`;

async function counts(url) {
  // prepare:false — the Supabase side may be a pooler in some setups.
  const sql = postgres(url, { max: 2, prepare: false, onnotice: () => {} });
  const tables = (await sql.unsafe(TABLES_SQL)).map((r) => r.table_name);
  const out = new Map();
  for (const t of tables) {
    const [row] = await sql.unsafe(`select count(*)::int as n from "${t}"`);
    out.set(t, row.n);
  }
  await sql.end({ timeout: 5 });
  return out;
}

const [source, target] = await Promise.all([counts(sourceUrl), counts(targetUrl)]);

let failures = 0;
const names = [...new Set([...source.keys(), ...target.keys()])].sort();
for (const t of names) {
  const s = source.get(t);
  const g = target.get(t);
  if (s === undefined) {
    console.log(`  ~ ${t}: target-only (${g} rows) — expected for fork tables`);
  } else if (g === undefined) {
    console.log(`  ✗ ${t}: missing on target (source has ${s})`);
    failures++;
  } else if (s !== g) {
    console.log(`  ✗ ${t}: source ${s} ≠ target ${g}`);
    failures++;
  } else {
    console.log(`  ✓ ${t}: ${s}`);
  }
}

console.log(failures === 0 ? '\nAll matched.' : `\n${failures} mismatch(es).`);
process.exit(failures === 0 ? 0 : 1);

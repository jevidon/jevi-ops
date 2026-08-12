#!/usr/bin/env -S tsx
/**
 * generate-illustrations — draw board illustrations for every active
 * non-system domain in one pass, via the same compose → sanitize
 * pipeline the settings page uses.
 *
 * Usage (from repo root):
 *   pnpm --filter @jevi-ops/api exec tsx scripts/generate-illustrations.ts [--commit] [--force]
 *
 * By default renders land as CANDIDATES (illustration_draft) so each one
 * can be reviewed with Keep/Discard on its domain settings page — saved
 * art is never touched. --commit writes straight to the saved
 * illustration instead (bulk convenience). Without --force, domains
 * whose target column is already populated are skipped.
 *
 * Falls back to the procedural library when the configured LLM is
 * unreachable or its output fails the sanitizer, so the script always
 * completes — the per-domain log line says which path drew each picture.
 *
 * Env: same as the API server (DATABASE_URL + LLM config), loaded by
 * src/lib/env.ts from the repo/app .env files.
 */

import { and, eq } from 'drizzle-orm';
import { getDb } from '../src/lib/db.js';
import { composeDomainIllustration } from '../src/lib/illustration.js';
import { llmDescription } from '../src/lib/llm.js';
import { stewardship_domains, type DomainIllustration } from '../src/db/schema.js';

const force = process.argv.includes('--force');
const commit = process.argv.includes('--commit');

const db = getDb();
console.log(`LLM: ${await llmDescription()}`);
console.log(`Mode: ${commit ? 'commit (writes saved illustration)' : 'draft (candidates for review)'}`);

const domains = await db.query.stewardship_domains.findMany({
  columns: { id: true, name: true, description: true, illustration: true, illustration_draft: true },
  where: and(
    eq(stewardship_domains.active, true),
    eq(stewardship_domains.is_system, false),
  ),
  orderBy: stewardship_domains.name,
});

let drawn = 0;
let skipped = 0;
for (const d of domains) {
  const existing = commit ? d.illustration : d.illustration_draft;
  if (existing && !force) {
    skipped++;
    console.log(`· ${d.name} — ${commit ? 'already has saved art' : 'already has a pending candidate'} (${existing.source}); skipping (use --force to redraw)`);
    continue;
  }
  const { svg, source } = await composeDomainIllustration({
    name: d.name,
    description: d.description ?? null,
  });
  const record: DomainIllustration = {
    svg,
    style: 'engraved',
    source,
    generated_at: new Date().toISOString(),
  };
  await db
    .update(stewardship_domains)
    .set(commit ? { illustration: record } : { illustration_draft: record })
    .where(eq(stewardship_domains.id, d.id));
  drawn++;
  console.log(`✓ ${d.name} — ${source === 'llm' ? 'drawn by the model' : 'library motif'}${commit ? '' : ' (candidate — review on the settings page)'}`);
}

console.log(`Done: ${drawn} drawn, ${skipped} skipped.`);
process.exit(0);

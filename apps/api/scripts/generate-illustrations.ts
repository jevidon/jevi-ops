#!/usr/bin/env -S tsx
/**
 * generate-illustrations — backfill board illustrations for every active
 * non-system domain in one pass, via the same compose → sanitize →
 * persist pipeline the "Redraw illustration" button uses.
 *
 * Usage (from repo root):
 *   pnpm --filter @jevi-ops/api exec tsx scripts/generate-illustrations.ts [--force]
 *
 * By default only domains with no stored illustration are drawn; --force
 * redraws everything. Domains fall back to the procedural library when
 * the configured LLM is unreachable or its output fails the sanitizer,
 * so the script always completes — the per-domain log line says which
 * path drew each picture.
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

const db = getDb();
console.log(`LLM: ${await llmDescription()}`);

const domains = await db.query.stewardship_domains.findMany({
  columns: { id: true, name: true, description: true, illustration: true },
  where: and(
    eq(stewardship_domains.active, true),
    eq(stewardship_domains.is_system, false),
  ),
  orderBy: stewardship_domains.name,
});

let drawn = 0;
let skipped = 0;
for (const d of domains) {
  if (d.illustration && !force) {
    skipped++;
    console.log(`· ${d.name} — already has art (${d.illustration.source}); skipping (use --force to redraw)`);
    continue;
  }
  const { svg, source } = await composeDomainIllustration({
    name: d.name,
    description: d.description ?? null,
  });
  const illustration: DomainIllustration = {
    svg,
    style: 'engraved',
    source,
    generated_at: new Date().toISOString(),
  };
  await db
    .update(stewardship_domains)
    .set({ illustration })
    .where(eq(stewardship_domains.id, d.id));
  drawn++;
  console.log(`✓ ${d.name} — ${source === 'llm' ? 'drawn by the model' : 'library motif'}`);
}

console.log(`Done: ${drawn} drawn, ${skipped} skipped.`);
process.exit(0);

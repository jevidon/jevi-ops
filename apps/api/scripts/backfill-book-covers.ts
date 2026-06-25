#!/usr/bin/env -S tsx
/**
 * backfill-book-covers — fill in missing cover_image_url on books rows
 * by hitting the Open Library Search + Covers API.
 *
 * Strategy:
 *   1. Query books where cover_image_url IS NULL
 *   2. For each, hit https://openlibrary.org/search.json?title=...&author=...
 *      (or by ISBN if the column is set)
 *   3. Pick the top match's cover_i, build
 *      https://covers.openlibrary.org/b/id/{cover_i}-M.jpg
 *   4. UPDATE the row
 *
 * Usage:
 *   pnpm tsx apps/api/scripts/backfill-book-covers.ts [--dry-run] [--limit N]
 *
 * Env vars (read from repo root .env):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Doesn't overwrite existing cover_image_url values — manual entries
 * always win. Re-run any time you want to fill in newer books.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ─── env ─────────────────────────────────────────────────────────────────
// Cheap .env reader so we don't need to pull in dotenv as a dep.
const envPath = join(process.cwd(), '.env');
let envText = '';
try { envText = readFileSync(envPath, 'utf8'); } catch { /* no .env, fall back to process.env */ }
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (!m) continue;
  if (!process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"(.*)"$/, '$1');
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ─── CLI flags ───────────────────────────────────────────────────────────
const dryRun = process.argv.includes('--dry-run');
const limitArg = process.argv.indexOf('--limit');
const limit = limitArg >= 0 ? parseInt(process.argv[limitArg + 1] ?? '0', 10) : 0;

// ─── Open Library helpers ───────────────────────────────────────────────

interface OLDoc { cover_i?: number; title?: string; author_name?: string[] }
interface OLResp { docs?: OLDoc[] }

async function lookupByIsbn(isbn: string): Promise<string | null> {
  // The covers endpoint redirects to the actual image and returns 200
  // even for non-existent ISBNs (with a tiny blank placeholder). The
  // search API is more reliable for verifying coverage.
  const url = `https://openlibrary.org/search.json?isbn=${encodeURIComponent(isbn)}&limit=1`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as OLResp;
  const cover_i = data.docs?.[0]?.cover_i;
  if (!cover_i) return null;
  return `https://covers.openlibrary.org/b/id/${cover_i}-M.jpg`;
}

async function lookupByTitleAuthor(title: string, author: string | null): Promise<string | null> {
  const params = new URLSearchParams();
  params.set('title', title);
  if (author) params.set('author', author);
  params.set('limit', '5');
  const res = await fetch(`https://openlibrary.org/search.json?${params}`);
  if (!res.ok) return null;
  const data = (await res.json()) as OLResp;
  // Walk top 5 results — first one with a cover wins. Top result without
  // a cover is common for re-printings; the second/third often have one.
  for (const doc of data.docs ?? []) {
    if (doc.cover_i) return `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`;
  }
  return null;
}

async function findCover(book: { title: string; author: string | null; isbn: string | null }): Promise<string | null> {
  if (book.isbn) {
    const byIsbn = await lookupByIsbn(book.isbn.trim());
    if (byIsbn) return byIsbn;
  }
  return lookupByTitleAuthor(book.title, book.author?.trim() || null);
}

// ─── main ────────────────────────────────────────────────────────────────

async function main() {
  let query = sb
    .from('books')
    .select('id, title, author, isbn, cover_image_url')
    .is('cover_image_url', null)
    .order('created_at', { ascending: true });
  if (limit > 0) query = query.limit(limit);

  const { data: books, error } = await query;
  if (error) {
    console.error('failed to query books:', error.message);
    process.exit(1);
  }
  if (!books || books.length === 0) {
    console.log('No books missing cover_image_url. Nothing to do.');
    return;
  }

  console.log(`${dryRun ? '[DRY RUN] ' : ''}Found ${books.length} books missing covers.`);

  let filled = 0;
  let skipped = 0;
  for (const b of books) {
    const cover = await findCover(b);
    if (!cover) {
      console.log(`  ✗ ${b.title} — no cover found`);
      skipped += 1;
      continue;
    }
    console.log(`  ✓ ${b.title} → ${cover}`);
    if (!dryRun) {
      const { error: updErr } = await sb
        .from('books')
        .update({ cover_image_url: cover })
        .eq('id', b.id);
      if (updErr) {
        console.error(`    update failed: ${updErr.message}`);
        skipped += 1;
        continue;
      }
    }
    filled += 1;
    // Be polite to Open Library — 100ms between requests is plenty.
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log(`\n${dryRun ? '[DRY RUN] would have ' : ''}Filled ${filled}, skipped ${skipped}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

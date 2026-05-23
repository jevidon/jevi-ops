#!/usr/bin/env -S tsx
/**
 * import-notes — bulk-import an Obsidian vault (or any folder of .md files)
 * into the dashboard's notes / quotes / journal_entries tables.
 *
 * Strategy:
 *   1. Walk the vault, skip plugin/config folders.
 *   2. Parse each file: YAML frontmatter, body, original date.
 *   3. Route via heuristics first (folder + filename prefix), Claude
 *      for the rest. Heuristics handle ~150 of 412 files without an API call.
 *   4. Dedup by SHA-256 of normalized body text vs. existing rows in DB.
 *   5. Insert with the file's original date as created_at.
 *
 * Usage:
 *   tsx apps/api/scripts/import-notes.ts --vault ~/Documents/Main [--dry-run] [--limit N]
 *
 * Env vars (read from repo root .env):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   ANTHROPIC_API_KEY
 *   ANTHROPIC_MODEL              (optional; defaults to claude-opus-4-7)
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, basename, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import yaml from 'js-yaml';

// ─── Env setup ─────────────────────────────────────────────────────────
const here = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: join(here, '../../../.env'), override: true });

const SUPABASE_URL = requireEnv('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
const ANTHROPIC_API_KEY = requireEnv('ANTHROPIC_API_KEY');
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-7';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

// ─── CLI args ──────────────────────────────────────────────────────────
interface Args {
  vault: string;
  dryRun: boolean;
  limit?: number;
  only?: string; // folder filter substring, e.g. "Daily"
}

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--vault') args.vault = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--limit') args.limit = parseInt(argv[++i] ?? '0', 10) || undefined;
    else if (a === '--only') args.only = argv[++i];
  }
  if (!args.vault) {
    console.error('Usage: tsx apps/api/scripts/import-notes.ts --vault <path> [--dry-run] [--limit N] [--only <folder>]');
    process.exit(1);
  }
  return args as Args;
}

// ─── File walking ──────────────────────────────────────────────────────
// Skip these top-level subdirs entirely — they're plugin config, not notes.
const SKIP_DIRS = new Set(['.obsidian', '.trash', '.git', 'node_modules', 'copilot']);

function walkVault(root: string): string[] {
  const out: string[] = [];
  function recurse(dir: string) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name.startsWith('.') && name !== '.md') continue;
      if (SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) recurse(full);
      else if (st.isFile() && name.endsWith('.md') && st.size > 0) out.push(full);
    }
  }
  recurse(root);
  return out;
}

// ─── Frontmatter parsing ───────────────────────────────────────────────
interface ParsedFile {
  path: string;          // absolute
  relPath: string;       // relative to vault root, forward-slashed
  folder: string;        // top-level subfolder (e.g. "Daily")
  subPath: string;       // path inside vault, e.g. "Readwise/Books/Stewardship.md"
  basename: string;      // file name without dir
  bodyOriginal: string;  // markdown without frontmatter
  bodyHash: string;      // sha-256 of normalized body for dedup
  tags: string[];        // tags from frontmatter
  createdAt: string;     // ISO timestamp — frontmatter.created → filename → mtime
  mtime: string;         // file mtime (fallback)
}

function parseFile(absPath: string, vaultRoot: string): ParsedFile | null {
  const raw = readFileSync(absPath, 'utf-8');
  if (!raw.trim()) return null;

  const { frontmatter, body } = splitFrontmatter(raw);
  if (!body.trim()) return null;

  const rel = relative(vaultRoot, absPath).split('\\').join('/'); // win-safe
  const parts = rel.split('/');
  const folder = parts[0] ?? '';
  const subPath = rel;
  const base = basename(absPath);

  // Date precedence: frontmatter.created → filename pattern → file mtime.
  const fmCreated = parseFrontmatterDate(frontmatter?.created);
  const nameDate = parseDateFromFilename(base);
  const mtime = statSync(absPath).mtime.toISOString();
  const createdAt = fmCreated ?? nameDate ?? mtime;

  const tagsRaw = frontmatter?.tags;
  const tags = Array.isArray(tagsRaw)
    ? tagsRaw.map(String)
    : typeof tagsRaw === 'string'
      ? [tagsRaw]
      : [];

  return {
    path: absPath,
    relPath: rel,
    folder,
    subPath,
    basename: base,
    bodyOriginal: body.trim(),
    bodyHash: sha256(normalize(body)),
    tags,
    createdAt,
    mtime,
  };
}

function splitFrontmatter(raw: string): { frontmatter: Record<string, unknown> | null; body: string } {
  // Pattern: ---\n<yaml>\n---\n<body>
  if (!raw.startsWith('---')) return { frontmatter: null, body: raw };
  const end = raw.indexOf('\n---', 4);
  if (end === -1) return { frontmatter: null, body: raw };
  const yamlText = raw.slice(4, end);
  const body = raw.slice(end + 4).replace(/^\r?\n/, '');
  try {
    const parsed = yaml.load(yamlText);
    if (parsed && typeof parsed === 'object') {
      return { frontmatter: parsed as Record<string, unknown>, body };
    }
  } catch {
    /* malformed YAML — treat as no frontmatter */
  }
  return { frontmatter: null, body };
}

function parseFrontmatterDate(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') {
    // Accept YYYY-MM-DD or full ISO.
    const m = v.match(/^\d{4}-\d{2}-\d{2}/);
    if (m) {
      const iso = new Date(v.length === 10 ? v + 'T12:00:00Z' : v);
      if (!isNaN(iso.getTime())) return iso.toISOString();
    }
  }
  return null;
}

function parseDateFromFilename(name: string): string | null {
  // Match patterns like "Journal - 2024-12-05.md" or "2024-12-05 Topic.md".
  const m = name.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const iso = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`);
  return isNaN(iso.getTime()) ? null : iso.toISOString();
}

function normalize(s: string): string {
  // Whitespace/casing-insensitive for dedup. Don't collapse meaningful content.
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

// ─── Routing ────────────────────────────────────────────────────────────
type NoteRoute = {
  kind: 'note';
  source_type: 'own_thought' | 'reading_response' | 'meeting_note' | 'brainstorm' | 'observation' | 'other';
  source_reference?: string;
  tags?: string[];
  needs_review?: boolean;
};
type QuoteRoute = {
  kind: 'quote';
  source_type: string;
  source_author?: string;
  source_reference?: string;
  tags?: string[];
};
type JournalRoute = {
  kind: 'journal_entry';
  entry_date: string; // YYYY-MM-DD
};
type SkipRoute = { kind: 'skip'; reason: string };
type Route = NoteRoute | QuoteRoute | JournalRoute | SkipRoute;

function heuristicRoute(file: ParsedFile): Route | null {
  const { folder, subPath, basename: base, tags } = file;

  // 1. Most specific: Daily journal entries (filename pattern + folder)
  if (folder === 'Daily' && /^Journal - \d{4}-\d{2}-\d{2}/.test(base)) {
    const d = parseDateFromFilename(base);
    if (d) return { kind: 'journal_entry', entry_date: d.slice(0, 10) };
  }

  // 2. Readwise highlights → quotes
  if (subPath.startsWith('Readwise/Books/')) {
    return { kind: 'quote', source_type: 'book', source_author: extractReadwiseAuthor(base) };
  }
  if (subPath.startsWith('Readwise/Articles/')) {
    return { kind: 'quote', source_type: 'article', source_reference: stripMdExt(base) };
  }
  if (subPath.startsWith('Readwise/Tweets/')) {
    return { kind: 'quote', source_type: 'other', tags: ['twitter'] };
  }

  // 3. Filename prefix gives us channel/source attribution — check this BEFORE
  // folder-based fallbacks so an "_Inbox/TWJ - X.md" still gets the Tech With
  // Jerad source_reference, just with needs_review=true added below.
  let prefixRoute: NoteRoute | null = null;
  if (base.startsWith('FN - ')) {
    prefixRoute = { kind: 'note', source_type: 'own_thought', source_reference: 'Field Notes', tags: dedupeTags('fieldnotes', tags) };
  } else if (base.startsWith('TWJ - ')) {
    prefixRoute = { kind: 'note', source_type: 'own_thought', source_reference: 'Tech With Jerad', tags: dedupeTags('twj', tags) };
  } else if (base.startsWith('Faith - ')) {
    prefixRoute = { kind: 'note', source_type: 'own_thought', tags: dedupeTags('faith', tags) };
  }

  // 4. Folder context layers on top of (or stands in for) the prefix.
  if (folder === 'Recaps') {
    return mergeNote(prefixRoute, { kind: 'note', source_type: 'meeting_note' });
  }
  if (folder === '_Inbox') {
    // Treat _Inbox as "definitely needs review" but keep any prefix attribution.
    return mergeNote(prefixRoute, { kind: 'note', source_type: 'own_thought', needs_review: true });
  }
  if (folder === 'Actions') {
    return mergeNote(prefixRoute, { kind: 'note', source_type: 'own_thought', tags: ['action'] });
  }

  // 5. If we found a prefix and the folder isn't special, use the prefix route.
  if (prefixRoute) return prefixRoute;

  // 6. Open Projects — project-linked notes need Claude to pick the project.
  if (folder === 'Open Projects') return null;

  return null;
}

// Lowercases + dedupes a list of tags (one new tag + frontmatter array).
function dedupeTags(injected: string, fromFrontmatter: string[]): string[] {
  const set = new Set<string>([injected.toLowerCase()]);
  for (const t of fromFrontmatter) set.add(String(t).toLowerCase());
  return Array.from(set);
}

// Merges a prefix-derived note with a folder-derived note. Prefix wins on
// source_reference; folder wins on needs_review / source_type. Tags merge,
// deduped + lowercased.
function mergeNote(prefix: NoteRoute | null, folder: NoteRoute): NoteRoute {
  if (!prefix) return folder;
  const tags = Array.from(new Set([...(prefix.tags ?? []), ...(folder.tags ?? [])].map((t) => t.toLowerCase())));
  return {
    kind: 'note',
    source_type: folder.source_type, // folder context wins (e.g., _Inbox stays own_thought, Recaps becomes meeting_note)
    source_reference: prefix.source_reference ?? folder.source_reference,
    tags,
    needs_review: folder.needs_review ?? prefix.needs_review,
  };
}

function extractReadwiseAuthor(base: string): string | undefined {
  // Readwise file names often follow "Book Title by Author Name.md".
  const stripped = stripMdExt(base);
  const m = stripped.match(/\bby\s+(.+)$/i);
  return m ? m[1].trim() : undefined;
}

function stripMdExt(s: string): string {
  return s.replace(/\.md$/i, '');
}

// ─── Claude classifier (for files heuristics couldn't route) ────────────
interface ClassifierContext {
  projects: { id: string; name: string; domain?: string }[];
  domains: { id: string; name: string }[];
  people: { id: string; name: string }[];
}

const CLASSIFIER_SYSTEM = `You classify a markdown note from an Obsidian vault into the dashboard's schema.

Return ONE JSON object — no preamble, no markdown fences:

{
  "kind": "note" | "quote" | "journal_entry",
  "source_type": "...",
  "source_reference": "...",   // optional
  "tags": ["..."],              // optional, lowercase
  "needs_review": false,        // true if ambiguous
  "related_project_id": "...",  // optional UUID from context
  "related_person_id": "..."    // optional UUID from context
}

Rules:
- "note" source_type: "own_thought" | "reading_response" | "meeting_note" | "brainstorm" | "observation" | "other"
- "quote" source_type: "book" | "article" | "podcast" | "conversation" | "sermon" | "other"
- "journal_entry" only if explicitly journaling about a day; otherwise prefer "note".
- Use related_project_id when the note clearly mentions a project (by name).
- Use related_person_id when the note is about a specific person.
- needs_review=true if the routing is uncertain.
- Lowercase tags. Avoid generic tags like "note".
- Be conservative — when in doubt, "own_thought" with needs_review=true.`;

async function classifyWithClaude(
  client: Anthropic,
  file: ParsedFile,
  ctx: ClassifierContext,
): Promise<Route> {
  const payload = {
    folder: file.folder,
    subPath: file.subPath,
    filename: file.basename,
    frontmatter_tags: file.tags,
    body_preview: file.bodyOriginal.slice(0, 2000),
    context: {
      projects: ctx.projects.slice(0, 30),
      domains: ctx.domains,
      people: ctx.people.slice(0, 50),
    },
  };

  const res = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 1024,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'low' },
    system: [{ type: 'text', text: CLASSIFIER_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: JSON.stringify(payload, null, 2),
      },
    ],
  } as Anthropic.MessageCreateParamsNonStreaming);

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  // Strip accidental markdown fences just in case.
  let cleaned = text;
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }

  try {
    const parsed = JSON.parse(cleaned);
    return parsed as Route;
  } catch {
    return { kind: 'note', source_type: 'own_thought', needs_review: true };
  }
}

// ─── DB layer ──────────────────────────────────────────────────────────
async function gatherContext(sb: SupabaseClient): Promise<ClassifierContext> {
  const [projects, domains, people] = await Promise.all([
    sb.from('projects').select('id, name, domain_id, stewardship_domains(name)').limit(200),
    sb.from('stewardship_domains').select('id, name').eq('active', true),
    sb.from('people').select('id, name').limit(200),
  ]);
  return {
    projects: ((projects.data ?? []) as { id: string; name: string; stewardship_domains?: { name?: string } | null }[]).map((p) => ({
      id: p.id,
      name: p.name,
      domain: p.stewardship_domains?.name,
    })),
    domains: (domains.data ?? []) as { id: string; name: string }[],
    people: (people.data ?? []) as { id: string; name: string }[],
  };
}

async function fetchExistingNoteHashes(sb: SupabaseClient): Promise<Set<string>> {
  // We dedup by hashing the body. Pre-fetch every existing body, hash it,
  // and reject incoming files whose hash collides. Fine at our scale (low
  // thousands of rows max).
  const out = new Set<string>();
  const [notes, quotes, journal] = await Promise.all([
    sb.from('notes').select('body').limit(5000),
    sb.from('quotes').select('text').limit(5000),
    sb.from('journal_entries').select('transcription_text').limit(5000),
  ]);
  for (const row of notes.data ?? []) {
    if (row.body) out.add(sha256(normalize(row.body)));
  }
  for (const row of quotes.data ?? []) {
    if (row.text) out.add(sha256(normalize(row.text)));
  }
  for (const row of journal.data ?? []) {
    if (row.transcription_text) out.add(sha256(normalize(row.transcription_text)));
  }
  return out;
}

async function insertRow(sb: SupabaseClient, file: ParsedFile, route: Route): Promise<void> {
  if (route.kind === 'skip') return;
  if (route.kind === 'journal_entry') {
    // For journals, the entry_date IS the meaningful date (when the journaling
    // happened). Override created_at to match it so /library and chronological
    // views surface the entry on the right day, not the day the Obsidian file
    // happened to be created in some later migration.
    const entryIso = new Date(`${route.entry_date}T12:00:00Z`).toISOString();
    const { error } = await sb.from('journal_entries').insert({
      entry_date: route.entry_date,
      transcription_text: file.bodyOriginal,
      source: 'import:obsidian',
      created_at: entryIso,
    });
    if (error) throw new Error(`journal_entries insert failed: ${error.message}`);
    return;
  }
  if (route.kind === 'quote') {
    const { error } = await sb.from('quotes').insert({
      text: file.bodyOriginal,
      source_type: route.source_type,
      source_author: route.source_author ?? null,
      source_reference: route.source_reference ?? null,
      tags: route.tags ?? [],
      added_via: 'import:obsidian',
      created_at: file.createdAt,
    });
    if (error) throw new Error(`quotes insert failed: ${error.message}`);
    return;
  }
  // note
  const { error } = await sb.from('notes').insert({
    body: file.bodyOriginal,
    source_type: route.source_type,
    source_reference: route.source_reference ?? null,
    tags: route.tags ?? [],
    needs_review: route.needs_review ?? false,
    created_at: file.createdAt,
  });
  if (error) throw new Error(`notes insert failed: ${error.message}`);
}

// ─── Main ──────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log(`Importer starting`);
  console.log(`  vault: ${args.vault}`);
  console.log(`  dry-run: ${args.dryRun}`);
  if (args.limit) console.log(`  limit: ${args.limit}`);
  if (args.only) console.log(`  only: ${args.only}`);
  console.log();

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  console.log('Walking vault…');
  let allFiles = walkVault(args.vault);
  if (args.only) {
    allFiles = allFiles.filter((f) => f.includes(`/${args.only}/`) || f.endsWith(`/${args.only}`));
  }
  if (args.limit) allFiles = allFiles.slice(0, args.limit);
  console.log(`  found ${allFiles.length} .md files\n`);

  console.log('Loading classifier context (projects, domains, people)…');
  const ctx = await gatherContext(sb);
  console.log(`  ${ctx.projects.length} projects, ${ctx.domains.length} domains, ${ctx.people.length} people\n`);

  console.log('Loading existing content hashes for dedup…');
  const existingHashes = args.dryRun ? new Set<string>() : await fetchExistingNoteHashes(sb);
  console.log(`  ${existingHashes.size} existing rows\n`);

  const stats = { note: 0, quote: 0, journal_entry: 0, dup: 0, skip: 0, error: 0 };
  let claudeCalls = 0;

  for (const filePath of allFiles) {
    const file = parseFile(filePath, args.vault);
    if (!file) {
      stats.skip += 1;
      console.log(`SKIP  ${relative(args.vault, filePath)}  (empty)`);
      continue;
    }

    // Dedup
    if (existingHashes.has(file.bodyHash)) {
      stats.dup += 1;
      console.log(`DUP   ${file.subPath}`);
      continue;
    }

    let route: Route | null = heuristicRoute(file);
    if (!route) {
      try {
        route = await classifyWithClaude(anthropic, file, ctx);
        claudeCalls += 1;
      } catch (err) {
        stats.error += 1;
        console.error(`ERR   ${file.subPath} — classifier failed: ${(err as Error).message}`);
        continue;
      }
    }

    const label = formatRoute(route);
    console.log(`${routeBadge(route)}  ${file.subPath}  →  ${label}  [${file.createdAt.slice(0, 10)}]`);

    if (!args.dryRun) {
      try {
        await insertRow(sb, file, route);
        existingHashes.add(file.bodyHash);
      } catch (err) {
        stats.error += 1;
        console.error(`      ↳ INSERT FAILED: ${(err as Error).message}`);
        continue;
      }
    }
    if (route.kind === 'skip') stats.skip += 1;
    else stats[route.kind] += 1;
  }

  console.log();
  console.log('─── Summary ────────────────────────────────────────');
  console.log(`Notes:           ${stats.note}`);
  console.log(`Quotes:          ${stats.quote}`);
  console.log(`Journal entries: ${stats.journal_entry}`);
  console.log(`Duplicates:      ${stats.dup}`);
  console.log(`Skipped:         ${stats.skip}`);
  console.log(`Errors:          ${stats.error}`);
  console.log(`Claude calls:    ${claudeCalls}`);
  console.log(args.dryRun ? '(dry-run — no DB writes happened)' : '(committed to DB)');
}

function routeBadge(r: Route): string {
  if (r.kind === 'note') return 'NOTE ';
  if (r.kind === 'quote') return 'QUOTE';
  if (r.kind === 'journal_entry') return 'JRNL ';
  return 'SKIP ';
}

function formatRoute(r: Route): string {
  if (r.kind === 'note') {
    const bits: string[] = [r.source_type];
    if (r.source_reference) bits.push(`src:${r.source_reference}`);
    if (r.needs_review) bits.push('needs_review');
    if (r.tags?.length) bits.push(`tags:[${r.tags.join(',')}]`);
    return bits.join(' · ');
  }
  if (r.kind === 'quote') {
    const bits: string[] = [r.source_type];
    if (r.source_author) bits.push(`by:${r.source_author}`);
    if (r.source_reference) bits.push(`src:${r.source_reference}`);
    if (r.tags?.length) bits.push(`tags:[${r.tags.join(',')}]`);
    return bits.join(' · ');
  }
  if (r.kind === 'journal_entry') return r.entry_date;
  return r.reason ?? 'skip';
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});

import { desc, eq } from 'drizzle-orm';
import type { Db } from './db.js';
import {
  books,
  content_items,
  journal_entries,
  milestones,
  notes,
  people,
  projects,
  quotes,
  stewardship_domains,
  tasks,
} from '../db/schema.js';

// Fuzzy match helpers — resolve a transcript phrase like "the Reviews plugin"
// to a concrete row ID. Strategy: case-insensitive substring match against
// the entity's primary text field, ranked by length similarity.
//
// Returns the best match (highest score) or null if no candidate scores above
// the threshold. The parser is responsible for triggering disambiguation
// before we get here — if it returns a *_match string, we assume the user's
// intent was a single specific entity.

interface MatchCandidate {
  id: string;
  label: string;
}

function score(query: string, target: string): number {
  const q = query.toLowerCase().trim();
  const t = target.toLowerCase().trim();
  if (!q || !t) return 0;

  // Exact or full-substring hit wins. Otherwise score by word overlap.
  if (t === q) return 1;
  if (t.includes(q) || q.includes(t)) {
    const lenRatio = Math.min(q.length, t.length) / Math.max(q.length, t.length);
    return 0.6 + 0.3 * lenRatio;
  }

  const qWords = new Set(q.split(/\s+/).filter((w) => w.length > 2));
  const tWords = new Set(t.split(/\s+/).filter((w) => w.length > 2));
  if (qWords.size === 0 || tWords.size === 0) return 0;
  let hits = 0;
  for (const w of qWords) if (tWords.has(w)) hits += 1;
  return (hits / qWords.size) * 0.55;
}

function best(query: string, candidates: MatchCandidate[]): MatchCandidate | null {
  if (!query) return null;
  let bestCandidate: MatchCandidate | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    const s = score(query, c.label);
    if (s > bestScore) {
      bestScore = s;
      bestCandidate = c;
    }
  }
  // Threshold tuned for the spec's example ("the Reviews plugin" → "Reviews v2.4 plugin")
  return bestScore >= 0.5 ? bestCandidate : null;
}

export async function matchProject(db: Db, query: string | undefined): Promise<string | null> {
  if (!query) return null;
  const rows = await db.query.projects.findMany({
    columns: { id: true, name: true },
    where: eq(projects.status, 'active'),
    limit: 100,
  });
  return best(query, rows.map((r) => ({ id: r.id, label: r.name })))?.id ?? null;
}

export async function matchDomain(db: Db, query: string | undefined): Promise<string | null> {
  if (!query) return null;
  const rows = await db.query.stewardship_domains.findMany({
    columns: { id: true, name: true },
    where: eq(stewardship_domains.active, true),
  });
  return best(query, rows.map((r) => ({ id: r.id, label: r.name })))?.id ?? null;
}

export async function matchPerson(db: Db, query: string | undefined): Promise<string | null> {
  if (!query) return null;
  const rows = await db.query.people.findMany({ columns: { id: true, name: true }, limit: 500 });
  return best(query, rows.map((r) => ({ id: r.id, label: r.name })))?.id ?? null;
}

export async function matchTask(db: Db, query: string | undefined): Promise<string | null> {
  if (!query) return null;
  // Look at open tasks first — completing an already-done task is unlikely.
  const rows = await db.query.tasks.findMany({
    columns: { id: true, title: true },
    where: eq(tasks.status, 'open'),
    limit: 200,
  });
  return best(query, rows.map((r) => ({ id: r.id, label: r.title })))?.id ?? null;
}

export async function matchBook(db: Db, query: string | undefined): Promise<string | null> {
  if (!query) return null;
  const rows = await db.query.books.findMany({
    columns: { id: true, title: true, author: true },
    limit: 500,
  });
  return best(query, rows.map((r) => ({
    id: r.id,
    label: r.author ? `${r.title} ${r.author}` : r.title,
  })))?.id ?? null;
}

export async function matchContentItem(db: Db, query: string | undefined): Promise<string | null> {
  if (!query) return null;
  const rows = await db.query.content_items.findMany({
    columns: { id: true, title: true },
    limit: 200,
  });
  return best(query, rows.map((r) => ({ id: r.id, label: r.title })))?.id ?? null;
}

/** Fuzzy match against quote text + source_author + source_reference.
 *  Useful for "the Cal Newport quote about focus" → quote id. */
export async function matchQuote(db: Db, query: string | undefined): Promise<string | null> {
  if (!query) return null;
  const rows = await db.query.quotes.findMany({
    columns: { id: true, text: true, source_author: true, source_reference: true },
    with: { book: { columns: { title: true, author: true } } },
    orderBy: desc(quotes.created_at),
    limit: 500,
  });
  const candidates = rows.map((r) => {
    // Build a search-friendly label that mixes attribution + a slice of the
    // quote text, so "Cal Newport quote about focus" can match on author +
    // the word 'focus' from the text body.
    const parts = [
      r.source_author,
      r.source_reference,
      r.book?.title,
      r.book?.author,
      r.text.slice(0, 120),
    ].filter(Boolean) as string[];
    return { id: r.id, label: parts.join(' · ') };
  });
  return best(query, candidates)?.id ?? null;
}

/** Fuzzy match a note by title + body excerpt + source_reference.
 *  Useful for "that note about X" → note id (used by the resurface intent). */
export async function matchNote(db: Db, query: string | undefined): Promise<string | null> {
  if (!query) return null;
  const rows = await db.query.notes.findMany({
    columns: { id: true, title: true, body: true, source_reference: true },
    orderBy: desc(notes.created_at),
    limit: 500,
  });
  const candidates = rows.map((r) => {
    const parts = [r.title, r.source_reference, r.body.slice(0, 160)].filter(Boolean) as string[];
    return { id: r.id, label: parts.join(' · ') };
  });
  return best(query, candidates)?.id ?? null;
}

/** Fuzzy match a journal entry by transcription excerpt. Dates ("yesterday's
 *  journal", "Monday's entry") aren't handled here — the parser should
 *  resolve those to a date and the executor can fetch by entry_date. */
export async function matchJournalEntry(db: Db, query: string | undefined): Promise<string | null> {
  if (!query) return null;
  const rows = await db.query.journal_entries.findMany({
    columns: { id: true, transcription_text: true, entry_date: true },
    orderBy: desc(journal_entries.entry_date),
    limit: 500,
  });
  const candidates = rows.map((r) => ({
    id: r.id,
    label: [r.entry_date, (r.transcription_text ?? '').slice(0, 180)].filter(Boolean).join(' · '),
  }));
  return best(query, candidates)?.id ?? null;
}

export async function matchMilestone(
  db: Db,
  projectId: string,
  query: string | undefined,
): Promise<string | null> {
  if (!query) return null;
  const rows = await db.query.milestones.findMany({
    columns: { id: true, title: true },
    where: eq(milestones.project_id, projectId),
    limit: 100,
  });
  return best(query, rows.map((r) => ({ id: r.id, label: r.title })))?.id ?? null;
}

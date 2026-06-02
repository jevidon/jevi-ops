import type { SupabaseClient } from '@supabase/supabase-js';

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

export async function matchProject(sb: SupabaseClient, query: string | undefined): Promise<string | null> {
  if (!query) return null;
  const { data } = await sb.from('projects').select('id, name').eq('status', 'active').limit(100);
  return best(query, (data ?? []).map((r) => ({ id: r.id, label: r.name })))?.id ?? null;
}

export async function matchDomain(sb: SupabaseClient, query: string | undefined): Promise<string | null> {
  if (!query) return null;
  const { data } = await sb.from('stewardship_domains').select('id, name').eq('active', true);
  return best(query, (data ?? []).map((r) => ({ id: r.id, label: r.name })))?.id ?? null;
}

export async function matchPerson(sb: SupabaseClient, query: string | undefined): Promise<string | null> {
  if (!query) return null;
  const { data } = await sb.from('people').select('id, name').limit(500);
  return best(query, (data ?? []).map((r) => ({ id: r.id, label: r.name })))?.id ?? null;
}

export async function matchTask(sb: SupabaseClient, query: string | undefined): Promise<string | null> {
  if (!query) return null;
  // Look at open tasks first — completing an already-done task is unlikely.
  const { data } = await sb.from('tasks').select('id, title').eq('status', 'open').limit(200);
  return best(query, (data ?? []).map((r) => ({ id: r.id, label: r.title })))?.id ?? null;
}

export async function matchBook(sb: SupabaseClient, query: string | undefined): Promise<string | null> {
  if (!query) return null;
  const { data } = await sb.from('books').select('id, title, author').limit(500);
  return best(query, (data ?? []).map((r) => ({
    id: r.id,
    label: r.author ? `${r.title} ${r.author}` : r.title,
  })))?.id ?? null;
}

export async function matchContentItem(sb: SupabaseClient, query: string | undefined): Promise<string | null> {
  if (!query) return null;
  const { data } = await sb.from('content_items').select('id, title').limit(200);
  return best(query, (data ?? []).map((r) => ({ id: r.id, label: r.title })))?.id ?? null;
}

/** Fuzzy match against quote text + source_author + source_reference.
 *  Useful for "the Cal Newport quote about focus" → quote id. */
export async function matchQuote(sb: SupabaseClient, query: string | undefined): Promise<string | null> {
  if (!query) return null;
  const { data } = await sb
    .from('quotes')
    .select('id, text, source_author, source_reference, book:books(title, author)')
    .order('created_at', { ascending: false })
    .limit(500);
  type Row = {
    id: string;
    text: string;
    source_author: string | null;
    source_reference: string | null;
    book: { title?: string | null; author?: string | null } | { title?: string | null; author?: string | null }[] | null;
  };
  const candidates = ((data ?? []) as unknown as Row[]).map((r) => {
    const book = Array.isArray(r.book) ? r.book[0] : r.book;
    // Build a search-friendly label that mixes attribution + a slice of the
    // quote text, so "Cal Newport quote about focus" can match on author +
    // the word 'focus' from the text body.
    const parts = [
      r.source_author,
      r.source_reference,
      book?.title,
      book?.author,
      r.text.slice(0, 120),
    ].filter(Boolean) as string[];
    return { id: r.id, label: parts.join(' · ') };
  });
  return best(query, candidates)?.id ?? null;
}

/** Fuzzy match a note by title + body excerpt + source_reference.
 *  Useful for "that note about X" → note id (used by the resurface intent). */
export async function matchNote(sb: SupabaseClient, query: string | undefined): Promise<string | null> {
  if (!query) return null;
  const { data } = await sb
    .from('notes')
    .select('id, title, body, source_reference')
    .order('created_at', { ascending: false })
    .limit(500);
  type Row = { id: string; title: string | null; body: string; source_reference: string | null };
  const candidates = ((data ?? []) as Row[]).map((r) => {
    const parts = [r.title, r.source_reference, r.body.slice(0, 160)].filter(Boolean) as string[];
    return { id: r.id, label: parts.join(' · ') };
  });
  return best(query, candidates)?.id ?? null;
}

/** Fuzzy match a journal entry by transcription excerpt. Dates ("yesterday's
 *  journal", "Monday's entry") aren't handled here — the parser should
 *  resolve those to a date and the executor can fetch by entry_date. */
export async function matchJournalEntry(sb: SupabaseClient, query: string | undefined): Promise<string | null> {
  if (!query) return null;
  const { data } = await sb
    .from('journal_entries')
    .select('id, transcription_text, entry_date')
    .order('entry_date', { ascending: false })
    .limit(500);
  type Row = { id: string; transcription_text: string | null; entry_date: string };
  const candidates = ((data ?? []) as Row[]).map((r) => ({
    id: r.id,
    label: [r.entry_date, (r.transcription_text ?? '').slice(0, 180)].filter(Boolean).join(' · '),
  }));
  return best(query, candidates)?.id ?? null;
}

export async function matchMilestone(
  sb: SupabaseClient,
  projectId: string,
  query: string | undefined,
): Promise<string | null> {
  if (!query) return null;
  const { data } = await sb.from('milestones').select('id, title').eq('project_id', projectId).limit(100);
  return best(query, (data ?? []).map((r) => ({ id: r.id, label: r.title })))?.id ?? null;
}

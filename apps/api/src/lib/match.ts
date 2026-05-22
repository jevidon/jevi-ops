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

export async function matchMilestone(
  sb: SupabaseClient,
  projectId: string,
  query: string | undefined,
): Promise<string | null> {
  if (!query) return null;
  const { data } = await sb.from('milestones').select('id, title').eq('project_id', projectId).limit(100);
  return best(query, (data ?? []).map((r) => ({ id: r.id, label: r.title })))?.id ?? null;
}

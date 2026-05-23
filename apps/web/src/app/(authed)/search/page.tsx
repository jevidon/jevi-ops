import Link from 'next/link';
import { ScreenHeader } from '@/components/ScreenHeader';
import { searchApi, ApiError, type SearchResults } from '@/lib/api';
import { SearchInput } from './search-input';

// Global search across notes, quotes, tasks, content, books, projects.
// The actual querying happens server-side (parallel ILIKE per column);
// this page just renders grouped results. The input is a client child
// that pushes ?q=… to the URL, re-rendering this server component.

export const dynamic = 'force-dynamic';

const EMPTY: SearchResults = {
  query: '',
  notes: [],
  quotes: [],
  tasks: [],
  content: [],
  books: [],
  projects: [],
  people: [],
};

// Trim a long body to a single-line snippet centered on the first match
// when possible. Keeps the list dense; full body is one click away.
function snippet(text: string, query: string, max = 140): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= max) return cleaned;
  const lower = cleaned.toLowerCase();
  const idx = query ? lower.indexOf(query.toLowerCase()) : -1;
  if (idx < 0) return cleaned.slice(0, max) + '…';
  const start = Math.max(0, idx - 40);
  const end = Math.min(cleaned.length, start + max);
  return (start > 0 ? '…' : '') + cleaned.slice(start, end) + (end < cleaned.length ? '…' : '');
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q: rawQ } = await searchParams;
  const q = (rawQ ?? '').trim();

  let results: SearchResults = EMPTY;
  let errorMessage: string | null = null;

  if (q.length >= 2) {
    try {
      results = await searchApi.search(q);
    } catch (err) {
      errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
    }
  }

  const totalHits =
    results.notes.length +
    results.quotes.length +
    results.tasks.length +
    results.content.length +
    results.books.length +
    results.projects.length +
    results.people.length;

  return (
    <div>
      <ScreenHeader
        eyebrow="Search"
        title="Find anything"
        meta={q.length >= 2 ? `${totalHits} result${totalHits === 1 ? '' : 's'}` : undefined}
      />
      <div className="hairline" />

      <SearchInput initialQuery={q} />

      {errorMessage && (
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-accent">
          {errorMessage}
        </div>
      )}

      {q.length < 2 && (
        <div className="px-5 lg:px-0 mt-10 font-sans text-[13px] text-ink-3 italic">
          Start typing to search across the whole library.
        </div>
      )}

      {q.length >= 2 && totalHits === 0 && !errorMessage && (
        <div className="px-5 lg:px-0 mt-10 font-sans text-[13px] text-ink-3 italic">
          No matches for &ldquo;{q}&rdquo;.
        </div>
      )}

      {q.length >= 2 && totalHits > 0 && (
        <div className="px-5 lg:px-0 mt-6 space-y-10 pb-10">
          {results.notes.length > 0 && (
            <ResultsSection title="Notes" count={results.notes.length}>
              {results.notes.map((n) => (
                <li key={n.id} className="py-2 border-b border-line/40">
                  <Link
                    href={`/library/notes/${n.id}`}
                    className="block hover:bg-surface-2/30 -mx-2 px-2 py-1 transition-colors"
                  >
                    <div className="font-sans text-[14px] text-ink">
                      {n.title || snippet(n.body, q, 80)}
                    </div>
                    {n.title && (
                      <div className="mt-0.5 font-sans text-[13px] text-ink-3">
                        {snippet(n.body, q)}
                      </div>
                    )}
                    <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
                      {n.source_type.replace('_', ' ')}
                    </div>
                  </Link>
                </li>
              ))}
            </ResultsSection>
          )}

          {results.quotes.length > 0 && (
            <ResultsSection title="Quotes" count={results.quotes.length}>
              {results.quotes.map((qt) => (
                <li key={qt.id} className="py-2 border-b border-line/40">
                  <Link
                    href={`/library/quotes/${qt.id}`}
                    className="block hover:bg-surface-2/30 -mx-2 px-2 py-1 transition-colors"
                  >
                    <div className="font-serif text-[15px] text-ink italic">
                      “{snippet(qt.text, q)}”
                    </div>
                    {(qt.source_author || qt.book?.title) && (
                      <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
                        — {qt.source_author || qt.book?.author || 'Unknown'}
                        {qt.book?.title ? ` · ${qt.book.title}` : ''}
                      </div>
                    )}
                  </Link>
                </li>
              ))}
            </ResultsSection>
          )}

          {results.tasks.length > 0 && (
            <ResultsSection title="Tasks" count={results.tasks.length}>
              {results.tasks.map((t) => (
                <li key={t.id} className="py-2 border-b border-line/40">
                  <Link
                    href={`/tasks/${t.id}`}
                    className="flex items-baseline gap-3 hover:bg-surface-2/30 -mx-2 px-2 py-1 transition-colors"
                  >
                    <span
                      className={`font-mono text-[10px] uppercase tracking-wider w-12 shrink-0 ${
                        t.status === 'done' ? 'text-ink-3' : 'text-accent'
                      }`}
                    >
                      {t.status === 'done' ? '✓ done' : 'open'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div
                        className={`font-sans text-[14px] ${
                          t.status === 'done' ? 'text-ink-3 line-through' : 'text-ink'
                        }`}
                      >
                        {t.title}
                      </div>
                      {t.notes && (
                        <div className="mt-0.5 font-sans text-[13px] text-ink-3">
                          {snippet(t.notes, q)}
                        </div>
                      )}
                      {t.project && (
                        <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
                          {t.project.name}
                        </div>
                      )}
                    </div>
                    {t.due_date && (
                      <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3 shrink-0">
                        {t.due_date}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ResultsSection>
          )}

          {results.content.length > 0 && (
            <ResultsSection title="Content" count={results.content.length}>
              {results.content.map((c) => (
                <li key={c.id} className="py-2 border-b border-line/40">
                  <Link
                    href={`/content/${c.id}`}
                    className="block hover:bg-surface-2/30 -mx-2 px-2 py-1 transition-colors"
                  >
                    <div className="font-sans text-[14px] text-ink">{c.title}</div>
                    {c.outline_md && (
                      <div className="mt-0.5 font-sans text-[13px] text-ink-3">
                        {snippet(c.outline_md, q)}
                      </div>
                    )}
                    <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
                      {c.type.replace('_', ' ')} · {c.status.replace('_', ' ')}
                      {c.domain?.name ? ` · ${c.domain.name}` : ''}
                    </div>
                  </Link>
                </li>
              ))}
            </ResultsSection>
          )}

          {results.books.length > 0 && (
            <ResultsSection title="Books" count={results.books.length}>
              {results.books.map((b) => (
                <li key={b.id} className="py-2 border-b border-line/40">
                  <Link
                    href={`/library/books/${b.id}`}
                    className="block hover:bg-surface-2/30 -mx-2 px-2 py-1 transition-colors"
                  >
                    <div className="font-sans text-[14px] text-ink">{b.title}</div>
                    <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
                      {b.author ?? 'Unknown author'} · {b.status.replace('_', ' ')}
                    </div>
                  </Link>
                </li>
              ))}
            </ResultsSection>
          )}

          {results.people.length > 0 && (
            <ResultsSection title="People" count={results.people.length}>
              {results.people.map((p) => (
                <li key={p.id} className="py-2 border-b border-line/40">
                  <Link
                    href={`/people/${p.id}`}
                    className="block hover:bg-surface-2/30 -mx-2 px-2 py-1 transition-colors"
                  >
                    <div className="font-sans text-[14px] text-ink">{p.name}</div>
                    <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-ink-3 flex flex-wrap gap-x-2">
                      {p.relationship_type && <span>{p.relationship_type}</span>}
                      {p.company && <span>· {p.company}</span>}
                      {p.email && <span>· {p.email}</span>}
                    </div>
                    {p.notes && (
                      <div className="mt-0.5 font-sans text-[13px] text-ink-3">
                        {snippet(p.notes, q)}
                      </div>
                    )}
                  </Link>
                </li>
              ))}
            </ResultsSection>
          )}

          {results.projects.length > 0 && (
            <ResultsSection title="Projects" count={results.projects.length}>
              {results.projects.map((p) => (
                <li key={p.id} className="py-2 border-b border-line/40">
                  <Link
                    href={`/projects/${p.id}`}
                    className="flex items-baseline gap-3 hover:bg-surface-2/30 -mx-2 px-2 py-1 transition-colors"
                  >
                    {p.color && (
                      <span
                        className="inline-block w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: p.color }}
                        aria-hidden
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-sans text-[14px] text-ink">{p.name}</div>
                      {p.description && (
                        <div className="mt-0.5 font-sans text-[13px] text-ink-3">
                          {snippet(p.description, q)}
                        </div>
                      )}
                      <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
                        {p.status}
                        {p.domain?.name ? ` · ${p.domain.name}` : ''}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ResultsSection>
          )}
        </div>
      )}
    </div>
  );
}

function ResultsSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 eyebrow flex items-baseline justify-between">
        <span>{title}</span>
        <span className="text-ink-3">{count}</span>
      </div>
      <ul>{children}</ul>
    </section>
  );
}

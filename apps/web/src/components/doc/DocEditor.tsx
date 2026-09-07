'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import type { DocEntityType, DocRevision } from '@jevi-ops/shared';
import { MarkdownDoc, type PromoteContext } from './MarkdownDoc';
import { listDocRevisionsAction, saveDocAction } from './doc-actions';

// The overview editor (0050): a textarea with Write ⇄ Preview, ⌘S to save,
// an unsaved-change guard, and conflict handling. A save carries the
// version this draft was opened against; if someone (the agent, another
// tab) saved in between, the API refuses and the current body comes back —
// shown side by side, never silently replaced. History lists the saved
// versions; restoring one puts it in the draft (saved only when you save).

export function DocEditor({
  entity,
  id,
  initialBody,
  initialVersion,
  promote,
  onSaved,
  onCancel,
}: {
  entity: DocEntityType;
  id: string;
  initialBody: string;
  initialVersion: number;
  promote?: PromoteContext;
  onSaved: (body: string, version: number) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initialBody);
  const [version, setVersion] = useState(initialVersion);
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ doc_md: string | null; doc_version: number } | null>(null);
  const [history, setHistory] = useState<DocRevision[] | null>(null);
  const [saving, startSave] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dirty = draft !== initialBody;

  // Leaving the page with unsaved edits asks first.
  useEffect(() => {
    if (!dirty) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  const save = useCallback(
    (asVersion: number) => {
      setError(null);
      startSave(async () => {
        const res = await saveDocAction({ entity, id, body: draft, version: asVersion });
        if (res.ok) {
          setConflict(null);
          setVersion(res.doc_version);
          onSaved(res.doc_md ?? '', res.doc_version);
        } else if ('conflict' in res) {
          setConflict(res.conflict);
        } else {
          setError(res.error);
        }
      });
    },
    [draft, entity, id, onSaved],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save(version);
    }
  };

  const loadHistory = () =>
    startSave(async () => {
      setHistory(await listDocRevisionsAction({ entity, id }));
    });

  return (
    <div className="flex flex-col gap-3" onKeyDown={onKeyDown}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 border border-line p-0.5">
          {(['write', 'preview'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`px-3 py-1 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors ${
                mode === m ? 'bg-ink text-bg' : 'text-ink-3 hover:text-ink'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        <span className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-ink-4">
          v{version}{dirty ? ' · unsaved' : ''} · markdown · ⌘S saves
        </span>
        <button type="button" onClick={loadHistory} className="ml-auto font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 hover:text-ink-2">
          History
        </button>
      </div>

      {mode === 'write' ? (
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={Math.min(40, Math.max(12, draft.split('\n').length + 2))}
          spellCheck
          placeholder={'# Overview\n\nWhat this is, the specs that matter, links, decisions, the story so far.\n\n- [ ] a checklist line can become a task with → task'}
          className="w-full resize-y border border-line bg-surface px-3 py-2 font-mono text-[12.5px] leading-relaxed text-ink placeholder:text-ink-4 focus:border-ink-2 focus:outline-none"
        />
      ) : (
        <div className="min-h-[200px] border border-line bg-surface px-4 py-3">
          {draft.trim() ? <MarkdownDoc body={draft} promote={promote} /> : <p className="font-sans text-[13px] italic text-ink-3">Nothing to preview yet.</p>}
        </div>
      )}

      {conflict && (
        <div className="border border-accent/50 bg-surface p-3">
          <p className="font-sans text-[13px] text-ink mb-2">
            Someone saved version {conflict.doc_version} while you were editing. Your draft is untouched; theirs is below.
          </p>
          <div className="max-h-[240px] overflow-auto border border-line bg-bg px-3 py-2 mb-3">
            {conflict.doc_md ? <MarkdownDoc body={conflict.doc_md} /> : <p className="font-sans text-[13px] italic text-ink-3">Their version is empty.</p>}
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                setDraft(conflict.doc_md ?? '');
                setVersion(conflict.doc_version);
                setConflict(null);
              }}
              className="border border-line-strong px-3 py-1.5 font-sans text-[12px] font-semibold uppercase tracking-wider text-ink-2 hover:text-ink"
            >
              Use theirs
            </button>
            <button
              type="button"
              onClick={() => save(conflict.doc_version)}
              className="border border-accent px-3 py-1.5 font-sans text-[12px] font-semibold uppercase tracking-wider text-accent hover:bg-accent hover:text-bg"
            >
              Overwrite with mine
            </button>
          </div>
        </div>
      )}

      {history && (
        <div className="border border-line bg-surface p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-ink-3">History</span>
            <button type="button" onClick={() => setHistory(null)} className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 hover:text-ink-2">
              close
            </button>
          </div>
          {history.length === 0 ? (
            <p className="font-sans text-[12.5px] italic text-ink-3">No saved versions yet.</p>
          ) : (
            <ul className="divide-y divide-line/60">
              {history.map((r) => (
                <li key={r.id} className="flex items-baseline justify-between gap-3 py-1.5">
                  <span className="font-mono text-[11px] text-ink-2">
                    v{r.version} · {r.created_at.slice(0, 16).replace('T', ' ')}
                    {r.actor ? ` · ${r.actor.replace(/^session:/, '')}` : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(r.body ?? '');
                      setMode('write');
                    }}
                    className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 hover:text-accent"
                  >
                    restore into draft
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <p role="alert" className="font-sans text-[12px] text-accent">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={saving || !dirty}
          onClick={() => save(version)}
          className="bg-ink px-4 py-2 font-sans text-[12px] font-semibold uppercase tracking-wider text-bg hover:bg-ink-2 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => {
            if (dirty && !window.confirm('Discard unsaved changes?')) return;
            onCancel();
          }}
          className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 hover:text-ink-2"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

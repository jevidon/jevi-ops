'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocEntityType, DocRevision } from '@jevi-ops/shared';
import { MarkdownDoc, type PromoteContext } from './MarkdownDoc';
import { listDocRevisionsAction, saveDocAction } from './doc-actions';

// The overview editor (0050): a textarea with Write ⇄ Preview, ⌘S to save,
// an unsaved-change guard, and conflict handling. A save carries the
// version this draft was opened against; if someone (the agent, another
// tab) saved in between, the API refuses and the current body comes back —
// shown side by side, never silently replaced. History lists the saved
// versions; restoring one puts it in the draft (saved only when you save).
//
// Nothing typed is ever lost to a save in flight: the text sent is a
// SNAPSHOT, and if the draft moved on while the request was out, the
// editor stays open on the newer text (dirty again, one version ahead)
// instead of closing over it. Saves are serialised — a second ⌘S while one
// is pending is ignored — and leaving the page with unsaved edits asks
// first, for a Next link as well as a full navigation.

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
  // keepEditing: the draft moved on during the save — the parent should
  // record the saved body/version but leave the editor mounted.
  onSaved: (body: string, version: number, keepEditing: boolean) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initialBody);
  const [baseline, setBaseline] = useState(initialBody);
  const [version, setVersion] = useState(initialVersion);
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ doc_md: string | null; doc_version: number } | null>(null);
  const [history, setHistory] = useState<DocRevision[] | null>(null);
  const savingRef = useRef(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const dirty = draft !== baseline;

  // Leaving with unsaved edits asks first — a full navigation…
  useEffect(() => {
    if (!dirty) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  // …and a client-side one through any link on the page.
  useEffect(() => {
    if (!dirty) return;
    const guard = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.('a[href]');
      if (!anchor) return;
      if (!window.confirm('Discard unsaved changes to the overview?')) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('click', guard, true);
    return () => document.removeEventListener('click', guard, true);
  }, [dirty]);

  const save = useCallback(
    async (asVersion: number) => {
      if (savingRef.current) return;
      savingRef.current = true;
      setSaving(true);
      setError(null);
      setNotice(null);
      const snapshot = draftRef.current;
      try {
        const res = await saveDocAction({ entity, id, body: snapshot, version: asVersion });
        if (res.ok) {
          const saved = res.doc_md ?? '';
          setConflict(null);
          setVersion(res.doc_version);
          setBaseline(saved);
          const movedOn = draftRef.current !== snapshot;
          if (movedOn) setNotice(`Saved v${res.doc_version} — what you typed since is still unsaved.`);
          onSaved(saved, res.doc_version, movedOn);
        } else if ('conflict' in res) {
          setConflict(res.conflict);
        } else {
          setError(res.error);
        }
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [entity, id, onSaved],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void save(version);
    }
  };

  const loadHistory = async () => {
    setHistory(await listDocRevisionsAction({ entity, id }));
  };

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
        <button type="button" onClick={() => void loadHistory()} className="ml-auto font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 hover:text-ink-2">
          History
        </button>
      </div>

      {mode === 'write' ? (
        <textarea
          aria-label="Overview"
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
                setBaseline(conflict.doc_md ?? '');
                setVersion(conflict.doc_version);
                setConflict(null);
              }}
              className="border border-line-strong px-3 py-1.5 font-sans text-[12px] font-semibold uppercase tracking-wider text-ink-2 hover:text-ink"
            >
              Use theirs
            </button>
            <button
              type="button"
              onClick={() => void save(conflict.doc_version)}
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

      {notice && <p role="status" className="font-sans text-[12px] text-ink-2">{notice}</p>}
      {error && <p role="alert" className="font-sans text-[12px] text-accent">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={saving || !dirty}
          onClick={() => void save(version)}
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
          {dirty ? 'Discard' : 'Close'}
        </button>
      </div>
    </div>
  );
}

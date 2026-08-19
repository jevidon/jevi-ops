'use client';

import { useActionState, useOptimistic, startTransition } from 'react';
import { updateBriefingPanelsAction } from './actions';
import type { SyncResult } from './actions';

// Settings → Briefing. One row per panel, grouped by the column it lives in
// (column affinity is fixed in the registry; config controls visibility and
// order WITHIN a column). Each control computes the full next config array
// and posts it as hidden JSON — no single-move ambiguity. Rows reorder
// optimistically so ▲▼ feel instant; the server action then revalidates.
//
// The registry itself is server-only (it imports panel server components),
// so the page passes plain row data down instead.

export interface PanelRow {
  id: string;
  label: string;
  description: string;
  column: 'main' | 'rail';
  enabled: boolean;
  // Module-gated panels stay listed and orderable, with a note.
  gatedBy: string | null;
}

type Config = Array<{ id: string; enabled: boolean }>;

const toConfig = (rows: PanelRow[]): Config => rows.map((r) => ({ id: r.id, enabled: r.enabled }));

export function BriefingPanelsForm({ rows }: { rows: PanelRow[] }) {
  const [state, formAction] = useActionState<SyncResult | null, FormData>(
    async (_prev, formData) => updateBriefingPanelsAction(formData),
    null,
  );
  const [optimisticRows, applyRows] = useOptimistic<PanelRow[], PanelRow[]>(
    rows,
    (_current, next) => next,
  );

  function submit(next: PanelRow[]) {
    startTransition(() => {
      applyRows(next);
      const fd = new FormData();
      fd.set('config', JSON.stringify(toConfig(next)));
      formAction(fd);
    });
  }

  function toggle(id: string) {
    submit(optimisticRows.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
  }

  // Swap with the neighbor IN THE SAME COLUMN — other-column rows keep their
  // global positions, matching how the page composes per-column order.
  function move(id: string, dir: -1 | 1) {
    const next = [...optimisticRows];
    const i = next.findIndex((r) => r.id === id);
    if (i < 0) return;
    const column = next[i]!.column;
    let j = i + dir;
    while (j >= 0 && j < next.length && next[j]!.column !== column) j += dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    submit(next);
  }

  const columns: Array<{ key: 'main' | 'rail'; title: string }> = [
    { key: 'main', title: 'Main column' },
    { key: 'rail', title: 'Right rail' },
  ];

  return (
    <div className="flex flex-col gap-5">
      {columns.map(({ key, title }) => {
        const colRows = optimisticRows.filter((r) => r.column === key);
        return (
          <div key={key}>
            <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3 pb-1.5 border-b border-line">
              {title}
            </div>
            <div className="flex flex-col">
              {colRows.map((row, idx) => (
                <div key={row.id} className="flex items-center gap-3 py-2.5 border-b border-line last:border-b-0">
                  <div className="flex flex-col gap-0.5 shrink-0">
                    <ArrowButton label={`Move ${row.label} up`} disabled={idx === 0} onClick={() => move(row.id, -1)}>↑</ArrowButton>
                    <ArrowButton label={`Move ${row.label} down`} disabled={idx === colRows.length - 1} onClick={() => move(row.id, 1)}>↓</ArrowButton>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={`font-sans text-[14px] ${row.enabled ? 'text-ink' : 'text-ink-3'}`}>{row.label}</div>
                    <p className="font-sans text-[12px] text-ink-3 leading-relaxed mt-0.5">{row.description}</p>
                    {row.gatedBy && (
                      <p className="font-mono text-[10px] uppercase tracking-wider text-ink-3 mt-1">
                        Hidden while the {row.gatedBy} module is disabled
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => toggle(row.id)}
                    className={`shrink-0 px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-wider border rounded transition-colors ${
                      row.enabled
                        ? 'border-line text-ink-2 hover:border-accent hover:text-accent'
                        : 'bg-ink text-bg border-ink hover:bg-ink-2'
                    }`}
                  >
                    {row.enabled ? 'Hide' : 'Show'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {state && !state.ok && (
        <p className="font-sans text-[12px] text-accent">{state.message}</p>
      )}
    </div>
  );
}

function ArrowButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid place-items-center w-6 h-5 font-mono text-[11px] leading-none text-ink-3 border border-line rounded hover:text-ink hover:border-ink-3 transition-colors disabled:opacity-30 disabled:pointer-events-none"
    >
      {children}
    </button>
  );
}

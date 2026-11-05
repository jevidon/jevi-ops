'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { RecentActivityEntry, RecentActivityKind } from '@/lib/api';

const DOT_CLASSES: Record<RecentActivityKind, string> = {
  task_added: 'bg-ink-3',
  task_captured: 'bg-accent',
  task_completed: 'bg-good',
  task_waiting: 'bg-warn',
  content_added: 'border border-prio3',
};

export function RecentActivityList({ entries, initial = 6 }: { entries: RecentActivityEntry[]; initial?: number }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? entries : entries.slice(0, initial);
  const groups: Array<{ day: string; label: string; entries: RecentActivityEntry[] }> = [];
  for (const entry of visible) {
    const previous = groups.at(-1);
    if (previous?.day === entry.day) {
      previous.entries.push(entry);
    } else {
      groups.push({ day: entry.day, label: entry.day_label, entries: [entry] });
    }
  }

  return (
    <>
      {groups.map((group) => (
        <div key={group.day} className="mt-3 first:mt-0">
          <h3 className="eyebrow">{group.label}</h3>
          <ul>
            {group.entries.map((entry) => (
              <li key={entry.id}>
                <Link
                  href={entry.href}
                  className="group grid grid-cols-[3.75rem_7px_minmax(0,1fr)] items-baseline gap-x-2 border-b border-line py-1.5 sm:grid-cols-[3.75rem_7px_5.5rem_minmax(0,1fr)]"
                >
                  <span className="font-mono text-[11px] tabular-nums text-ink-3">{entry.time_label ?? '—'}</span>
                  <span aria-hidden="true" className={`size-[7px] self-start mt-[7px] rounded-full ${DOT_CLASSES[entry.kind]}`} />
                  <span className="col-start-3 row-start-2 font-mono text-[10px] uppercase tracking-wider text-ink-2 sm:row-start-1">{entry.label}</span>
                  <span className="col-start-3 row-start-1 truncate text-[13px] text-ink sm:col-start-4">
                    <span className="group-hover:text-accent">{entry.title}</span>
                    <span className={entry.location.inbox ? 'text-accent-ink' : 'text-ink-3'}>{' · '}{entry.location.label}</span>
                    {entry.detail && <span className="text-ink-3">{' · '}{entry.detail}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {entries.length > initial && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          className="mt-3 font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent"
        >
          {expanded ? 'Show fewer ↑' : `Show ${entries.length - initial} more ↓`}
        </button>
      )}
    </>
  );
}

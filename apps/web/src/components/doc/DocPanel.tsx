'use client';

import { useState } from 'react';
import type { DocEntityType } from '@jevi-ops/shared';
import { DocEditor } from './DocEditor';
import { MarkdownDoc, type PromoteContext } from './MarkdownDoc';

// The Overview slot (0050): the rendered document with an Edit affordance,
// or the editor. The one-line `description` stays the blurb in the header
// band; this is the living page underneath it.

export function DocPanel({
  entity,
  id,
  body,
  version,
  promote,
  emptyHint,
}: {
  entity: DocEntityType;
  id: string;
  body: string | null;
  version: number;
  promote?: PromoteContext;
  emptyHint: string;
}) {
  const [editing, setEditing] = useState(false);
  const [current, setCurrent] = useState<{ body: string; version: number }>({ body: body ?? '', version });

  if (editing) {
    return (
      <DocEditor
        entity={entity}
        id={id}
        initialBody={current.body}
        initialVersion={current.version}
        promote={promote}
        onSaved={(b, v, keepEditing) => {
          setCurrent({ body: b, version: v });
          // The draft moved on during the save: the editor stays open on
          // the newer text rather than closing over it.
          if (!keepEditing) setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div>
      {current.body.trim() ? (
        <MarkdownDoc body={current.body} promote={promote} />
      ) : (
        <p className="font-sans text-[13px] italic text-ink-3">{emptyHint}</p>
      )}
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 transition-colors hover:text-ink-2"
        >
          {current.body.trim() ? 'Edit overview' : 'Write the overview'}
        </button>
        {current.version > 1 && (
          <span className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-ink-4">v{current.version}</span>
        )}
      </div>
    </div>
  );
}

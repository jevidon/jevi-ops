'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { createConversationAction, type ConvResult } from './actions';

// Scoped "log a conversation" form. Dropped onto company/person/project
// detail with the matching association id pre-bound via a hidden field, so
// a manual call/meeting/text lands on the right timeline. Collapsed behind a
// "+ Log conversation" toggle to keep the detail page calm.

const TYPES = [
  { value: 'call', label: 'Call' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'in_person', label: 'In person' },
  { value: 'video_call', label: 'Video call' },
  { value: 'text_message', label: 'Text' },
  { value: 'social_dm', label: 'Social DM' },
  { value: 'email', label: 'Email' },
  { value: 'other', label: 'Other' },
];

const DIRECTIONS = [
  { value: 'outbound', label: 'Outbound (I reached out)' },
  { value: 'inbound', label: 'Inbound (they reached me)' },
  { value: 'internal', label: 'Internal / note' },
];

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-3 py-2 bg-ink text-bg font-mono text-[11px] uppercase tracking-wider hover:bg-ink-2 disabled:opacity-40 transition-colors"
    >
      {pending ? 'Logging…' : 'Log conversation'}
    </button>
  );
}

export function LogConversationForm({
  scope,
  revalidatePath,
}: {
  // Exactly one association id is bound; the others stay empty.
  scope: { company_id?: string; person_id?: string; project_id?: string };
  revalidatePath: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ConvResult | null, FormData>(
    createConversationAction,
    null,
  );

  // Collapse the form after a successful log (in an effect, not during render).
  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 font-mono text-[11px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
      >
        + Log conversation
      </button>
    );
  }

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-3 border border-line p-4">
      <input type="hidden" name="company_id" value={scope.company_id ?? ''} />
      <input type="hidden" name="person_id" value={scope.person_id ?? ''} />
      <input type="hidden" name="project_id" value={scope.project_id ?? ''} />
      <input type="hidden" name="revalidate_path" value={revalidatePath} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="eyebrow">Type</span>
          <select name="interaction_type" defaultValue="call" className="bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-sans text-[14px] text-ink">
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="eyebrow">Direction</span>
          <select name="direction" defaultValue="outbound" className="bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-sans text-[14px] text-ink">
            {DIRECTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="eyebrow">Summary <span className="text-accent">*</span></span>
        <textarea
          name="summary"
          required
          rows={3}
          placeholder="What was discussed…"
          className="bg-transparent border border-line focus:border-accent focus:outline-none p-2 font-sans text-[14px] text-ink resize-y placeholder:text-ink-3/60"
        />
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="eyebrow">When</span>
          <input type="date" name="occurred_at" className="bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-sans text-[14px] text-ink" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="eyebrow">Follow up by</span>
          <input type="date" name="followup_by" className="bg-transparent border-b border-line focus:border-accent focus:outline-none py-1.5 font-sans text-[14px] text-ink" />
        </label>
      </div>

      <div className="flex items-center gap-3">
        <Submit />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-ink transition-colors"
        >
          Cancel
        </button>
        {state?.ok === false && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-accent">{state.error}</span>
        )}
      </div>
    </form>
  );
}

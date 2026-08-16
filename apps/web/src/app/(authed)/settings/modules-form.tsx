'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  toggleHealthModuleAction,
  toggleRoutinesModuleAction,
  toggleRuleModuleAction,
  toggleShoppingModuleAction,
} from './actions';
import type { SyncResult } from './actions';

// Settings → Modules. One row per feature-flagged module (Health — Addendum
// 05; Routines — Addendum 06). Each toggle is its own form posting the desired
// next state; on success the layout revalidates so the rail nav updates.

function ToggleButton({ enabled }: { enabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`shrink-0 px-4 py-2 font-sans font-semibold text-[12px] uppercase tracking-wider transition-colors disabled:opacity-50 ${
        enabled
          ? 'border border-line text-ink-2 hover:border-accent hover:text-accent'
          : 'bg-ink text-bg hover:bg-ink-2'
      }`}
    >
      {pending ? 'Saving…' : enabled ? 'Disable' : 'Enable'}
    </button>
  );
}

function ModuleRow({
  name,
  description,
  enabled,
  action,
}: {
  name: string;
  description: string;
  enabled: boolean;
  action: (formData: FormData) => Promise<SyncResult>;
}) {
  const [state, formAction] = useActionState<SyncResult | null, FormData>(
    async (_prev, formData) => action(formData),
    null,
  );
  return (
    <div className="flex flex-col gap-2 py-2 border-b border-line last:border-b-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-sans text-[14px] text-ink">{name}</div>
          <p className="font-sans text-[12px] text-ink-3 leading-relaxed mt-0.5">{description}</p>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
            Status · {enabled ? 'enabled' : 'hidden'}
          </div>
        </div>
        <form action={formAction}>
          <input type="hidden" name="enabled" value={enabled ? 'false' : 'true'} />
          <ToggleButton enabled={enabled} />
        </form>
      </div>
      {state && (
        <p className={`font-sans text-[12px] ${state.ok ? 'text-ink-2' : 'text-accent'}`}>
          {state.message}
        </p>
      )}
    </div>
  );
}

export function ModulesForm({
  healthEnabled,
  routinesEnabled,
  ruleEnabled,
  shoppingEnabled,
}: {
  healthEnabled: boolean;
  routinesEnabled: boolean;
  ruleEnabled: boolean;
  shoppingEnabled: boolean;
}) {
  return (
    <div className="flex flex-col">
      <ModuleRow
        name="Shopping"
        description="Recurring shopping lists grouped by store. Check an item when it needs buying; marking it bought logs a purchase and resets it. When disabled it's hidden from the nav and its routes return 404. Lists and purchase history are retained."
        enabled={shoppingEnabled}
        action={toggleShoppingModuleAction}
      />
      <ModuleRow
        name="Health"
        description="Personal health record — visits, labs, metrics, medications, check-ins. When disabled it's hidden from the nav and its routes return 404. Your data is retained either way."
        enabled={healthEnabled}
        action={toggleHealthModuleAction}
      />
      <ModuleRow
        name="Routines"
        description="Daily habit check-off with streaks. When disabled it's hidden from the nav + Today, its routes 404, and its reminders + chat answers go quiet. Data is retained — turn it back on anytime. (Practices replaces this in v1.1.)"
        enabled={routinesEnabled}
        action={toggleRoutinesModuleAction}
      />
      <ModuleRow
        name="Daily Rule (retired)"
        description="The evening shutdown flow, five-check scoring, win rates, recap and hedge capture — retired, because daily self-scoring read as ranking. Tomorrow's Focus replaces the one part worth keeping. Every score, hedge and pause row was retained, so turning this back on restores the module intact."
        enabled={ruleEnabled}
        action={toggleRuleModuleAction}
      />
    </div>
  );
}

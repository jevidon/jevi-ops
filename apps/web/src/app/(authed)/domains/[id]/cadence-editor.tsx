'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { setCadenceRuleAction, type CadenceSaveResult } from './actions';
import {
  CADENCE_RULE_LABELS,
  CADENCE_RULE_TYPES,
  type CadenceRuleType,
} from './cadence-rules';

// Cadence rule editor. Owns the one entry in failure_patterns that the
// Briefing's "In brief" and the /domains pulse board care about. The
// "advanced" rule types (deadline_within_days, hours_exceed_quote,
// shoot_within_days, etc.) still get edited via SQL — they take more
// parameters than a single value, and editing them in a form would be a
// footgun. The server action preserves any advanced rules already in
// failure_patterns when it saves the cadence rule.

export function CadenceEditor({
  domainId,
  currentRule,
  currentValue,
}: {
  domainId: string;
  currentRule: CadenceRuleType;
  currentValue: number | null;
}) {
  const [state, formAction] = useActionState<CadenceSaveResult | null, FormData>(
    setCadenceRuleAction,
    null,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={domainId} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="eyebrow">Cadence rule</span>
          <select
            name="rule"
            defaultValue={currentRule}
            className="bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[13px] text-ink"
          >
            {CADENCE_RULE_TYPES.map((r) => (
              <option key={r} value={r}>
                {CADENCE_RULE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="eyebrow">Threshold (days)</span>
          <input
            type="number"
            name="value"
            min={1}
            step={1}
            placeholder="e.g. 7"
            defaultValue={currentValue ?? ''}
            className="bg-transparent border border-line focus:border-ink-2 focus:outline-none p-2 font-sans text-[13px] text-ink"
          />
        </label>
      </div>

      <p className="font-sans text-[12px] text-ink-3 leading-relaxed">
        Once a domain crosses the threshold, the Briefing&rsquo;s &ldquo;In
        brief&rdquo; surfaces it as slipping and the /domains pulse board
        sorts it worst-first. Pick &ldquo;None&rdquo; to drop the rule —
        the domain stays in the list but won&rsquo;t fire.
      </p>

      <div className="flex items-center gap-3 pt-1">
        <SaveButton />
        {state?.ok === false && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-accent">
            {state.error}
          </span>
        )}
        {state?.ok === true && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
            ✓ Saved
          </span>
        )}
      </div>
    </form>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="border border-line text-ink-2 hover:border-ink-2 hover:text-ink font-mono text-[10px] uppercase tracking-wider px-3 py-1.5 transition-colors disabled:opacity-40"
    >
      {pending ? 'Saving…' : 'Save cadence'}
    </button>
  );
}

'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { triageTaskAction, type TriageResult } from './actions';
import type { Task } from '@jerad-ops/shared';

interface ProjectOption {
  id: string;
  name: string;
  domain_id: string | null;
}
interface DomainOption {
  id: string;
  name: string;
  is_system?: boolean;
}

// One row per Inbox task. The whole row is a form so submitting one row
// doesn't disturb the rest of the list. After successful triage, the
// server action revalidates /inbox and this row simply disappears on the
// next render — no client-side optimistic removal needed.
export function TriageRow({
  task,
  domains,
  projects,
}: {
  task: Task;
  domains: DomainOption[];
  projects: ProjectOption[];
}) {
  const [state, formAction] = useActionState<TriageResult | null, FormData>(
    triageTaskAction,
    null,
  );

  return (
    <form action={formAction} className="py-3 border-b border-line/40">
      <input type="hidden" name="taskId" value={task.id} />

      <div className="font-sans text-[14px] text-ink leading-snug mb-2">
        {task.title}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <DestinationPicker domains={domains} projects={projects} />
        <SubmitButton />
        {state?.ok === false && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-accent">
            {state.error}
          </span>
        )}
      </div>
    </form>
  );
}

function DestinationPicker({
  domains,
  projects,
}: {
  domains: DomainOption[];
  projects: ProjectOption[];
}) {
  // Filter out system domains (Inbox itself shouldn't be a triage target).
  const userDomains = domains.filter((d) => !d.is_system);
  const projectsByDomain = new Map<string, ProjectOption[]>();
  const orphanProjects: ProjectOption[] = [];
  for (const p of projects) {
    if (p.domain_id) {
      const list = projectsByDomain.get(p.domain_id) ?? [];
      list.push(p);
      projectsByDomain.set(p.domain_id, list);
    } else {
      orphanProjects.push(p);
    }
  }
  return (
    <select
      name="selection"
      defaultValue=""
      className="bg-transparent border border-line focus:border-ink-2 focus:outline-none px-2 py-1 font-sans text-[13px] text-ink"
    >
      <option value="" disabled>Pick a destination…</option>
      {userDomains.map((d) => {
        const list = projectsByDomain.get(d.id) ?? [];
        return (
          <optgroup key={d.id} label={d.name}>
            <option value={`domain:${d.id}`}>{d.name} (domain)</option>
            {list.map((p) => (
              <option key={p.id} value={`project:${p.id}`}>{p.name}</option>
            ))}
          </optgroup>
        );
      })}
      {orphanProjects.length > 0 && (
        <optgroup label="Other projects">
          {orphanProjects.map((p) => (
            <option key={p.id} value={`project:${p.id}`}>{p.name}</option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="border border-line hover:border-ink-2 hover:text-ink text-ink-2 font-mono text-[10px] uppercase tracking-wider px-3 py-1 transition-colors disabled:opacity-50"
    >
      {pending ? 'Moving…' : 'Triage'}
    </button>
  );
}

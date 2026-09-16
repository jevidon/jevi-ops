'use client';
import { useEffect, useState, useTransition } from 'react';
import { BUILTIN_WORKFLOW_PRESETS, TaskWorkflowSchema, type TaskWorkflow, type WorkflowScope, type WorkflowStatus } from '@jevi-ops/shared';
import { configureWorkflow, deleteWorkflowPreset, saveWorkflowPreset } from './actions';
import { useTaskWorkflows } from './TaskWorkflows';

const BASIC: TaskWorkflow = { statuses: [{ id: 'open', label: 'Open', category: 'open' }, { id: 'done', label: 'Done', category: 'done' }] };
export function WorkflowSettings({ scope, id }: { scope: WorkflowScope; id: string }) {
  const registry = useTaskWorkflows();
  const config = registry.scopes.find(s => s.scope === scope && s.id === id);
  const [enabled, setEnabled] = useState(Boolean(config?.definition));
  const [draft, setDraft] = useState<TaskWorkflow>(config?.definition ?? BASIC);
  const [presetId, setPresetId] = useState('');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [pending, startTransition] = useTransition();
  useEffect(() => { setEnabled(Boolean(config?.definition)); setDraft(config?.definition ?? BASIC); }, [config?.revision, id]); // Sync after save or navigation.
  const update = (index: number, patch: Partial<WorkflowStatus>) => setDraft({ statuses: draft.statuses.map((s, i) => i === index ? { ...s, ...patch } : s) });
  const inputClass = 'rounded border border-line bg-bg px-2 py-1 text-[13px] text-ink';
  return <details className="my-4 rounded border border-line p-3">
    <summary className="cursor-pointer text-[13px] text-ink">Task statuses · {config?.definition ? 'Custom' : 'Checkboxes'}</summary>
    <fieldset disabled={pending} className="mt-3 space-y-3 disabled:opacity-60">
      <p className="text-[12px] text-ink-3">{scope === 'domain' ? 'Applies to tasks directly in this domain. Projects and areas choose their own settings.' : 'Applies to tasks and subtasks in this project or area.'}</p>
      <label className="flex gap-2 text-[13px]"><input type="checkbox" checked={enabled} onChange={e => { setEnabled(e.target.checked); setMessage(''); }} />Use custom statuses</label>
      {enabled ? <>
        <label className="block text-[12px]">Start from a preset
          <select aria-label="Workflow preset" className={`${inputClass} ml-2`} value={presetId} onChange={e => {
            const preset = registry.presets.find(p => p.id === e.target.value);
            setPresetId(e.target.value); if (preset) { setDraft(structuredClone(preset.definition)); setMessage('Preset copied into this draft. Save to apply it here.'); }
          }}><option value="">Choose…</option>{registry.presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </label>
        <p className="text-[12px] text-ink-3">Names are yours. Categories keep task views and reminders working. The first status in each category is its default. Satisfied states appear with completed tasks; recurring tasks roll forward when satisfied.</p>
        <div className="space-y-2">{draft.statuses.map((s, i) => <div key={s.id} className="flex flex-wrap gap-2">
          <input aria-label={`Status ${i + 1} name`} className={`${inputClass} min-w-0 flex-1`} value={s.label} maxLength={60} onChange={e => update(i, { label: e.target.value })} />
          <select aria-label={`Status ${i + 1} category`} className={inputClass} value={s.category} onChange={e => update(i, { category: e.target.value as WorkflowStatus['category'] })}>
            <option value="open">Actionable (Open)</option><option value="waiting">Waiting</option><option value="done">Satisfied (Done)</option>
          </select>
          <button type="button" aria-label={`Move ${s.label || 'status'} up`} disabled={i === 0} className="px-2 disabled:opacity-30" onClick={() => { const statuses = [...draft.statuses]; [statuses[i - 1], statuses[i]] = [statuses[i]!, statuses[i - 1]!]; setDraft({ statuses }); }}>↑</button>
          <button type="button" className="text-[12px] text-accent" onClick={() => setDraft({ statuses: draft.statuses.filter((_, n) => n !== i) })}>Remove</button>
        </div>)}</div>
        <button type="button" disabled={draft.statuses.length >= 20} className="text-[12px] underline" onClick={() => setDraft({ statuses: [...draft.statuses, { id: crypto.randomUUID(), label: '', category: 'open' }] })}>Add status</button>
        <p className="text-[12px] text-ink-3">Move tasks out of a status before removing it or changing its category. Renaming is safe.</p>
      </> : config?.definition && <p className="text-[12px] text-ink-3">Saving returns these tasks to checkboxes and clears their custom stages. Open, Waiting, and Done categories are preserved. Save a preset first if you want to reuse these labels.</p>}
      <button type="button" className="rounded bg-ink px-3 py-1.5 text-[13px] text-bg" onClick={() => {
        const parsed = TaskWorkflowSchema.safeParse(draft);
        if (enabled && !parsed.success) { setMessage(parsed.error.issues.map(i => i.message).join(' ')); return; }
        startTransition(async () => { const r = await configureWorkflow(scope, id, enabled ? draft : null, config?.revision ?? 0); setMessage(r.error ?? 'Task status settings saved.'); });
      }}>Save settings</button>
      {enabled && <div className="border-t border-line pt-3 space-y-2">
        <p className="text-[12px] text-ink-3">Save this draft as a preset available across the app. Applying a preset copies it; other projects keep their own settings.</p>
        <input aria-label="Preset name" className={inputClass} placeholder="Preset name" maxLength={80} value={name} onChange={e => setName(e.target.value)} />
        <button type="button" className="ml-2 text-[12px] underline" disabled={!name.trim()} onClick={() => {
          const parsed = TaskWorkflowSchema.safeParse(draft); if (!parsed.success) { setMessage(parsed.error.issues.map(i => i.message).join(' ')); return; }
          startTransition(async () => { const r = await saveWorkflowPreset(name, draft); setMessage(r.error ?? 'Preset saved for use anywhere.'); if (r.ok) setName(''); });
        }}>Save preset</button>
        {presetId && !BUILTIN_WORKFLOW_PRESETS.some(p => p.id === presetId) && <button type="button" className="block text-[12px] text-accent" onClick={() => startTransition(async () => { const r = await deleteWorkflowPreset(presetId); setMessage(r.error ?? 'Preset deleted. Existing project settings are unchanged.'); if (r.ok) setPresetId(''); })}>Delete selected preset</button>}
      </div>}
    </fieldset>
    {message && <p role="status" className="mt-3 text-[12px] text-ink-2">{message}</p>}
  </details>;
}

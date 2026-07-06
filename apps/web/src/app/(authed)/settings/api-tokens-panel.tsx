'use client';

import { useState, useTransition } from 'react';
import type { ApiTokenRow } from '@/lib/api';
import { createApiTokenAction, revokeApiTokenAction, type SyncResult } from './actions';

// Named bearer credentials for agents (Hermes, OpenClaw, …) and future
// edge-capture devices. The token value is displayed exactly once at
// creation — afterwards only name/kind/last-used metadata exists.

export function ApiTokensPanel({ tokens }: { tokens: ApiTokenRow[] }) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'agent' | 'device'>('agent');
  const [state, setState] = useState<(SyncResult & { token?: string }) | null>(null);

  const create = () =>
    startTransition(async () => {
      const fd = new FormData();
      fd.set('name', name);
      fd.set('kind', kind);
      const result = await createApiTokenAction(fd);
      setState(result);
      if (result.ok) setName('');
    });

  const revoke = (id: string) =>
    startTransition(async () => {
      setState(await revokeApiTokenAction(id));
    });

  const active = tokens.filter((t) => !t.revoked_at);
  const revoked = tokens.filter((t) => t.revoked_at);

  return (
    <div className="flex flex-col gap-4">
      <p className="font-sans text-[13px] text-ink-2 leading-relaxed">
        Give an agent or capture device its own credential instead of your session.
        Tokens carry full API access, can be revoked here any time, and can never
        mint further tokens.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 grow max-w-60">
          <span className="eyebrow">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. hermes"
            className="bg-transparent border border-line focus:border-accent focus:outline-none p-2 font-sans text-[14px] text-ink"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="eyebrow">Kind</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value === 'device' ? 'device' : 'agent')}
            className="bg-transparent border border-line focus:border-accent focus:outline-none p-2 font-sans text-[14px] text-ink"
          >
            <option value="agent">agent</option>
            <option value="device">device</option>
          </select>
        </label>
        <button
          onClick={create}
          disabled={pending || !name.trim()}
          className="bg-ink hover:bg-ink-2 disabled:opacity-40 disabled:cursor-not-allowed text-bg font-sans font-semibold text-[12px] uppercase tracking-wider px-3 py-2.5 transition-colors"
        >
          Create token
        </button>
      </div>

      {state && (
        <div className={`font-mono text-[11px] tracking-wider ${state.ok ? 'text-ink-2' : 'text-accent'}`}>
          {state.message}
        </div>
      )}
      {state?.token && (
        <div className="border border-accent px-3 py-2 font-mono text-[12px] text-ink break-all select-all">
          {state.token}
        </div>
      )}

      {active.length > 0 && (
        <ul className="flex flex-col divide-y divide-line border-t border-b border-line">
          {active.map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-2">
              <span className="font-sans text-[13px] text-ink">{t.name}</span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">{t.kind}</span>
              <span className="ml-auto font-mono text-[10px] text-ink-3">
                {t.last_used_at
                  ? `last used ${new Date(t.last_used_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                  : 'never used'}
              </span>
              <button
                onClick={() => revoke(t.id)}
                disabled={pending}
                className="border border-line hover:border-accent text-ink-3 hover:text-accent font-mono text-[10px] uppercase tracking-wider px-2 py-1 transition-colors"
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
      {revoked.length > 0 && (
        <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
          {revoked.length} revoked token{revoked.length === 1 ? '' : 's'} retained for audit.
        </div>
      )}
    </div>
  );
}

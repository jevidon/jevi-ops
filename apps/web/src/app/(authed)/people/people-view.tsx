'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { Person, RelationshipType } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { FacetRail, FacetGroup, FacetRow, FacetSep } from '@/components/FacetRail';

// People — relationships (v2 redesign, Jul 2026). Card grid, facet rail
// (Relationship + Company). This fork's list payload carries interaction/fact
// counts, not a last-interaction date, so cards show history depth instead
// of upstream's contact-silence pill.

const PERSON_REL: { value: RelationshipType; label: string; color: string }[] = [
  { value: 'client', label: 'Client', color: '#2F5D8A' },
  { value: 'family', label: 'Family', color: '#3B6A52' },
  { value: 'church', label: 'Church', color: '#6B5B95' },
  { value: 'friend', label: 'Friend', color: '#A8763E' },
  { value: 'team', label: 'Team', color: '#4A6B70' },
  { value: 'vendor', label: 'Vendor', color: '#8A4B3C' },
  { value: 'other', label: 'Other', color: '#8B847A' },
];
const REL_COLOR: Record<string, string> = Object.fromEntries(PERSON_REL.map((r) => [r.value, r.color]));
const REL_LABEL: Record<string, string> = Object.fromEntries(PERSON_REL.map((r) => [r.value, r.label]));

function initials(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

export function PeopleView({ people }: { people: Person[] }) {
  const [rels, setRels] = useState<Set<string>>(new Set());
  const [cos, setCos] = useState<Set<string>>(new Set());

  const toggle = (set: React.Dispatch<React.SetStateAction<Set<string>>>, v: string) =>
    set((s) => {
      const n = new Set(s);
      n.has(v) ? n.delete(v) : n.add(v);
      return n;
    });

  const withCompany = useMemo(
    () => people.map((p) => ({ p, company: p.company ?? null })),
    [people],
  );

  const companies = useMemo(
    () => [...new Set(withCompany.map((x) => x.company).filter((c): c is string => !!c))].sort(),
    [withCompany],
  );

  const visible = withCompany.filter(({ p, company }) => {
    if (rels.size && (!p.relationship_type || !rels.has(p.relationship_type))) return false;
    if (cos.size && (!company || !cos.has(company))) return false;
    return true;
  });

  const activeFilters = rels.size + cos.size;
  const reset = () => { setRels(new Set()); setCos(new Set()); };

  return (
    <div className="lg:flex">
      <FacetRail activeCount={activeFilters} onReset={reset}>
        <FacetGroup label="Relationship" action={activeFilters > 0 ? <ClearBtn onClick={reset} label="Reset" /> : undefined}>
          {PERSON_REL.map((r) => {
            const n = people.filter((p) => p.relationship_type === r.value).length;
            return n ? (
              <FacetRow key={r.value} on={rels.has(r.value)} onClick={() => toggle(setRels, r.value)} color={r.color} name={r.label} count={n} />
            ) : null;
          })}
        </FacetGroup>
        <FacetSep />
        {companies.length > 0 && (
          <FacetGroup label="Company" action={cos.size ? <ClearBtn onClick={() => setCos(new Set())} /> : undefined}>
            {companies.map((c) => (
              <FacetRow key={c} on={cos.has(c)} onClick={() => toggle(setCos, c)} name={c} count={withCompany.filter((x) => x.company === c).length} />
            ))}
          </FacetGroup>
        )}
      </FacetRail>

      <div className="flex-1 min-w-0 px-5 lg:px-0 lg:pl-8 pt-6 pb-24">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 mb-5">
          <div>
            <div className="eyebrow mb-2">Relationships · {visible.length} of {people.length} people</div>
            <h1 className="font-serif text-[40px] font-medium leading-[1.02] tracking-[-0.022em] text-ink">People</h1>
          </div>
          <Link href="/people/new" className="inline-flex items-center gap-1.5 h-[34px] px-3 rounded bg-ink border border-ink font-mono text-[10px] uppercase tracking-[0.09em] text-bg hover:bg-ink-2 transition-colors shrink-0">
            <Icon name="capture" size={14} /> Add person
          </Link>
        </div>

        {visible.length === 0 ? (
          <div className="pt-16 text-center">
            <div className="font-serif text-[25px] font-medium tracking-[-0.015em] text-ink">
              {activeFilters > 0 ? 'Nobody matches.' : 'No people yet.'}
            </div>
            <p className="mt-1.5 font-sans text-[14px] text-ink-3">
              {activeFilters > 0 ? 'Clear a filter on the left.' : 'Add a person to start your CRM.'}
            </p>
          </div>
        ) : (
          <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(258px, 1fr))' }}>
            {visible.map(({ p, company }) => (
              <Link key={p.id} href={`/people/${p.id}`} className="block rounded border border-line bg-bg px-4 pt-[15px] pb-[13px] hover:border-line-strong transition-colors">
                <div className="flex items-start gap-3 mb-3">
                  <span className="grid place-items-center w-[34px] h-[34px] shrink-0 rounded-full font-serif font-medium text-[13px] text-white" style={{ background: p.relationship_type ? REL_COLOR[p.relationship_type] : '#8B847A' }}>
                    {initials(p.name)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-serif text-[17px] font-medium leading-tight text-ink truncate">{p.name}</div>
                    <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 truncate">
                      {p.relationship_type ? REL_LABEL[p.relationship_type] : '—'}{company ? ` · ${company}` : ''}
                    </div>
                  </div>
                </div>
                {p.email && <div className="mb-[11px] font-mono text-[11px] text-ink-3 truncate">{p.email}</div>}
                <div className="flex items-center justify-between gap-2.5 pt-[11px] border-t border-line">
                  <span className="font-mono text-[10.5px] text-ink-4 whitespace-nowrap">
                    {historyLabel(p)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function historyLabel(p: Person): string {
  const logs = p.interaction_count ?? 0;
  const facts = p.fact_count ?? 0;
  if (!logs && !facts) return 'No history';
  return [logs ? `${logs} log` : null, facts ? `${facts} fact` : null].filter(Boolean).join(' · ');
}

function ClearBtn({ onClick, label = 'Clear' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} className="font-mono text-[9px] uppercase tracking-[0.09em] text-ink-3 hover:text-accent transition-colors">
      {label}
    </button>
  );
}

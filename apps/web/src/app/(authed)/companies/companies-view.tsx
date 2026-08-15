'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { Company, CompanyRelationshipType } from '@/lib/api';
import { Pill } from '@/components/Pill';
import { Icon } from '@/components/Icon';
import { FacetRail, FacetGroup, FacetRow, FacetSep } from '@/components/FacetRail';
import { todayIsoDate } from '@/lib/today';
import { silenceUrgency, silenceLabel } from '@/lib/silence';

// Companies — the CRM (v2 redesign, Jul 2026). Card grid, facet rail
// (Relationship + State), contact silence on the four urgency pills.

const COMPANY_REL: { value: CompanyRelationshipType; label: string }[] = [
  { value: 'active_client', label: 'Active client' },
  { value: 'prospect', label: 'Prospect' },
  { value: 'past_client', label: 'Past client' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'partner', label: 'Partner' },
  { value: 'brand_deal', label: 'Brand deal' },
  { value: 'other', label: 'Other' },
];
const REL_LABEL: Record<string, string> = Object.fromEntries(COMPANY_REL.map((r) => [r.value, r.label]));

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);
}

export function CompaniesView({ companies, today, tz }: { companies: Company[]; today: string; tz: string }) {
  const [rels, setRels] = useState<Set<string>>(new Set());
  const [silent, setSilent] = useState(false);
  const [hasProject, setHasProject] = useState(false);

  const toggle = (v: string) =>
    setRels((s) => {
      const n = new Set(s);
      n.has(v) ? n.delete(v) : n.add(v);
      return n;
    });

  const withDays = useMemo(
    () =>
      companies.map((c) => ({
        c,
        days: c.last_interaction_at
          ? Math.max(0, daysBetween(todayIsoDate(tz, new Date(c.last_interaction_at)), today))
          : null,
        projects: c.active_project_count ?? 0,
      })),
    [companies, today, tz],
  );

  const visible = withDays.filter(({ c, days, projects }) => {
    if (rels.size && (!c.relationship_type || !rels.has(c.relationship_type))) return false;
    if (silent && (days == null || days < 30)) return false;
    if (hasProject && projects === 0) return false;
    return true;
  });

  const activeFilters = rels.size + (silent ? 1 : 0) + (hasProject ? 1 : 0);
  const reset = () => { setRels(new Set()); setSilent(false); setHasProject(false); };
  const silentCount = withDays.filter((x) => x.days != null && x.days >= 30).length;
  const projectCount = withDays.filter((x) => x.projects > 0).length;

  return (
    <div className="lg:flex">
      <FacetRail activeCount={activeFilters} onReset={reset}>
        <FacetGroup label="Relationship" action={activeFilters > 0 ? <ClearBtn onClick={reset} label="Reset" /> : undefined}>
          {COMPANY_REL.map((r) => {
            const n = companies.filter((c) => c.relationship_type === r.value).length;
            return n ? <FacetRow key={r.value} on={rels.has(r.value)} onClick={() => toggle(r.value)} name={r.label} count={n} /> : null;
          })}
        </FacetGroup>
        <FacetSep />
        <FacetGroup label="State">
          <FacetRow on={silent} onClick={() => setSilent((v) => !v)} name="Silent 30d+" count={silentCount} />
          <FacetRow on={hasProject} onClick={() => setHasProject((v) => !v)} name="Has open project" count={projectCount} />
        </FacetGroup>
      </FacetRail>

      <div className="flex-1 min-w-0 px-5 lg:px-0 lg:pl-8 pt-6 pb-24">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 mb-5">
          <div>
            <div className="eyebrow mb-2">CRM · {visible.length} of {companies.length} companies</div>
            <h1 className="font-serif text-[40px] font-medium leading-[1.02] tracking-[-0.022em] text-ink">Companies</h1>
          </div>
          <Link href="/companies/new" className="inline-flex items-center gap-1.5 h-[34px] px-3 rounded bg-ink border border-ink font-mono text-[10px] uppercase tracking-[0.09em] text-bg hover:bg-ink-2 transition-colors shrink-0">
            <Icon name="capture" size={14} /> Add company
          </Link>
        </div>

        {visible.length === 0 ? (
          <div className="pt-16 text-center">
            <div className="font-serif text-[25px] font-medium tracking-[-0.015em] text-ink">
              {activeFilters > 0 ? 'No companies match.' : 'No companies yet.'}
            </div>
            <p className="mt-1.5 font-sans text-[14px] text-ink-3">
              {activeFilters > 0 ? 'Clear a filter on the left.' : 'Add a company to start your CRM.'}
            </p>
          </div>
        ) : (
          <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(258px, 1fr))' }}>
            {visible.map(({ c, days, projects }) => (
              <Link key={c.id} href={`/companies/${c.id}`} className="block rounded border border-line bg-bg px-4 pt-[15px] pb-[13px] hover:border-line-strong transition-colors">
                <div className="flex items-start justify-between gap-2.5 mb-2">
                  <span className="font-serif text-[17px] font-medium leading-tight text-ink truncate">{c.name}</span>
                  <Pill state={silenceUrgency(days)}>{silenceLabel(days)}</Pill>
                </div>
                <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 truncate">
                  {c.relationship_type ? REL_LABEL[c.relationship_type] : '—'}
                  {c.domain?.name ? ` · ${c.domain.name}` : ''}
                  {!c.active && <span className="text-accent"> · inactive</span>}
                </div>
                <div className="flex items-center gap-3.5 mt-3 pt-[11px] border-t border-line font-mono text-[10.5px]">
                  <span className="text-ink-3 whitespace-nowrap">{c.contact_count ?? 0} contact{(c.contact_count ?? 0) === 1 ? '' : 's'}</span>
                  <span className={`whitespace-nowrap ${projects ? 'text-ink-2' : 'text-ink-4'}`}>{projects} active</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ClearBtn({ onClick, label = 'Clear' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} className="font-mono text-[9px] uppercase tracking-[0.09em] text-ink-3 hover:text-accent transition-colors">
      {label}
    </button>
  );
}

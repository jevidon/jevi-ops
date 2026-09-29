import type { ReactNode } from 'react';
import { Icon, type IconName } from '../Icon';
import { AlmanacMark } from '../AlmanacMark';
import { FittedArt } from '../DomainArt';
import { domainColor } from '../../lib/domain-colors';
import type { ContainerRecord, TaskRecord } from './model';

// Local navigation delegates to the adapter; its visual vocabulary comes from
// BottomTabBar, Work cards, ScreenHeader and the shared Tailwind theme.
export function WorkspaceNavigation({ active, navigate, inert }: {
  active: 'domains' | 'search' | 'more';
  navigate: (name: string) => void;
  inert?: boolean;
}) {
  const tab = (name: 'agenda' | 'domains' | 'search' | 'more', label: string, icon?: IconName) => (
    <li>
      <button aria-current={active === name ? 'page' : undefined} onClick={() => navigate(name)}>
        {icon ? <Icon name={icon} size={22} /> : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></svg>}
        <span>{label}</span>
      </button>
    </li>
  );
  return <nav className="lw-navigation" aria-label="Primary navigation" inert={inert}>
    <ul>
      {tab('agenda', 'Agenda', 'agenda')}
      {tab('domains', 'Domains', 'domains')}
      <li><button aria-label="Capture" onClick={() => navigate('capture')}><span className="lw-capture-mark"><AlmanacMark className="h-9 w-9" /></span></button></li>
      {tab('search', 'Search', 'search')}
      {tab('more', 'More')}
    </ul>
  </nav>;
}

export function WorkspaceSection({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return <section className="lw-section"><div className="lw-section-heading"><h2 className="eyebrow">{title}</h2>{count != null && <span>{count}</span>}</div>{children}</section>;
}

export function DomainRow({ domain, tasks, onOpen }: { domain: ContainerRecord; tasks: TaskRecord[]; onOpen: () => void }) {
  const open = tasks.filter(t => t.domain_id === domain.id && t.status === 'open').length;
  const waiting = tasks.filter(t => t.domain_id === domain.id && t.status === 'waiting').length;
  return <button className="lw-domain" onClick={onOpen}>
    <span className="lw-domain-art"><FittedArt name={domain.name} svg={domain.illustration?.svg} color={domainColor(domain.name)} fit="xMaxYMid meet" /></span>
    <span className="lw-domain-copy"><span className="lw-domain-name">{domain.name}</span><span className="lw-meta">{open} open{waiting > 0 ? ` · ${waiting} waiting` : ''}</span></span>
    <Icon name="chev" size={15} className="text-ink-3 shrink-0" />
  </button>;
}

export function ProjectRow({ project, color, count, onOpen }: { project: ContainerRecord; color?: string; count: number; onOpen: () => void }) {
  return <button className="lw-project" onClick={onOpen}>
    <span className="lw-project-cap" style={{ backgroundColor: color ?? 'rgb(var(--ink-4))' }} />
    <span className="lw-project-body"><span className="lw-project-name">{project.name}<Icon name="chev" size={14} /></span><span className="lw-meta">{project.kind ?? 'Project'} · {count} {count === 1 ? 'task' : 'tasks'}</span></span>
  </button>;
}

export function MenuRow({ icon, children, onClick }: { icon: IconName; children: ReactNode; onClick: () => void }) {
  return <button className="lw-menu-row" onClick={onClick}><Icon name={icon} size={20} /><span>{children}</span><Icon name="chev" size={14} className="text-ink-3" /></button>;
}

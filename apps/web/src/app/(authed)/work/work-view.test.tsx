import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WorkDomain, WorkPayload, WorkProjectCard } from '@/lib/api';
import { ToastProvider } from '@/components/toast/ToastProvider';
import { WorkView } from './work-view';

vi.mock('./actions', () => ({ flipHolderAction: vi.fn(), setFocusAction: vi.fn(), clearFocusAction: vi.fn() }));
vi.mock('@/components/quick-add-task-action', () => ({ quickAddTaskAction: vi.fn() }));

const project = (id: string, asset: WorkProjectCard['asset'] = null): WorkProjectCard => ({
  id, name: id, asset, kind: 'target', client: null, target: null, cycle: null,
  pct: null, open: 3, overdue: 1, waiting: 0, waitOn: null, waitDays: null,
  recency: 'active today', flagged: false, paused: false, urgency: 'over',
});
const domain = (id: string, extra: Partial<WorkDomain> = {}): WorkDomain => ({
  id, name: id, parked: false, urgency: 'quiet',
  rollup: { open: 3, overdue: 1, waiting: 2, attention: 1 },
  direct: { open: 1, overdue: 0, waiting: 1, waitingAging: 0, today: 0 },
  projects: [], assets: [], content: [], ...extra,
});
const household = domain('Household', {
  assets: [{
    id: 'car', name: 'Family car', kind: 'vehicle', meter_unit: 'km', latest_reading: 12345,
    latest_reading_days_ago: 0, maintenance: { total: 3, overdue: 1, due: 0, due_soon: 0 },
    worst: 'overdue', data: 'complete', projects: 1, hero: null, flagged: false, urgency: 'over',
  }],
  projects: [project('Service brakes', { id: 'car', name: 'Family car' }), project('Kitchen refresh')],
  content: [{ id: 'article', title: 'Household guide', type: 'article', status: 'draft', holder: 'me',
    days: null, move: 'Write', target: null, myMoveDue: false, flagged: false, urgency: 'quiet' }],
});
const payload: WorkPayload = {
  domains: [household, domain('Creative work'), domain('Empty', { direct: { open: 0, overdue: 0, waiting: 0, waitingAging: 0, today: 0 } })],
  parked: [domain('Someday', { parked: true })], ideasCount: 2,
};
function mount(data = payload) {
  return render(<ToastProvider><WorkView payload={data} tomorrowFocus={null} tomorrowDate="2026-09-20" /></ToastProvider>);
}
function row(name: string) { return screen.getByRole('button', { name: `${name} Show contents` }); }

afterEach(() => { cleanup(); sessionStorage.clear(); vi.restoreAllMocks(); });

describe('compact domain browsing', () => {
  it('starts collapsed with context, stable panel associations and no sidebar facets', () => {
    mount();
    for (const d of payload.domains) {
      const button = row(d.name);
      expect(button.getAttribute('aria-expanded')).toBe('false');
      const panel = document.getElementById(button.getAttribute('aria-controls')!);
      expect(panel?.hidden).toBe(true);
      expect(button.textContent).toContain('3 open');
      expect(button.textContent).toContain('1 overdue');
    }
    expect(screen.queryByRole('link', { name: 'Service brakes' })).toBeNull();
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.queryByText('Status')).toBeNull();
  });

  it('supports Enter/Space, independent rows, explicit navigation and asset hierarchy', async () => {
    const user = userEvent.setup();
    mount();
    const button = row('Household');
    button.focus();
    await user.keyboard('{Enter}');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(button);
    expect(screen.getByRole('link', { name: 'Open domain: Household' }).getAttribute('href')).toBe('/domains/Household');
    const assetGroup = screen.getByRole('group', { name: 'Family car' });
    expect(within(assetGroup).getByRole('link', { name: /Service brakes/ })).toBeDefined();
    expect(within(assetGroup).queryByRole('link', { name: /Kitchen refresh/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Kitchen refresh/ })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Household guide' })).toBeDefined();
    expect(screen.getByRole('link', { name: /Direct tasks 1/ })).toBeDefined();
    await user.click(row('Creative work'));
    expect(button.getAttribute('aria-expanded')).toBe('true');
    button.focus();
    await user.keyboard(' ');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('link', { name: /Service brakes/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Creative work Hide contents' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('searches children without discarding siblings or expansion state', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(row('Household'));
    await user.type(screen.getByRole('searchbox'), 'brakes');
    expect(screen.queryByRole('button', { name: 'Creative work Show contents' })).toBeNull();
    expect(screen.getByRole('link', { name: /Kitchen refresh/ })).toBeDefined();
    expect(screen.getByRole('group', { name: 'Family car' })).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(row('Creative work')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Household Hide contents' })).toBeDefined();
    await user.type(screen.getByRole('searchbox'), 'no-such-domain');
    expect(screen.getByRole('status').textContent).toContain('No domains match');
  });

  it('keeps empty domains navigable and parked domains independently expandable', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(row('Empty'));
    expect(screen.getByText('Nothing open.')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Open domain: Empty' })).toBeDefined();
    await user.type(screen.getByRole('searchbox'), 'Someday');
    expect(screen.getByRole('status').textContent).toContain('Parked below');
    const parked = screen.getByRole('button', { name: 'Parked (1)' });
    await user.click(parked);
    expect(parked.getAttribute('aria-expanded')).toBe('true');
    expect(row('Someday').getAttribute('aria-expanded')).toBe('false');
    await user.click(row('Someday'));
    expect(screen.getByRole('link', { name: 'Open domain: Someday' })).toBeDefined();
  });

  it('restores search, parked visibility and expanded rows after returning', async () => {
    const user = userEvent.setup();
    const view = mount();
    await user.click(row('Household'));
    await user.click(screen.getByRole('button', { name: 'Parked (1)' }));
    await user.type(screen.getByRole('searchbox'), 'Household');
    view.unmount();
    mount();
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('Household');
    expect(screen.getByRole('button', { name: 'Household Hide contents' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Parked (0)' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('still works with inaccessible storage or malformed saved state', () => {
    sessionStorage.setItem('work-domain-browsing-v1', '{broken');
    const view = mount();
    fireEvent.click(row('Household'));
    expect(screen.getByRole('link', { name: 'Open domain: Household' })).toBeDefined();
    view.unmount();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    mount();
    fireEvent.click(row('Household'));
    expect(screen.getByRole('link', { name: 'Open domain: Household' })).toBeDefined();
  });
});

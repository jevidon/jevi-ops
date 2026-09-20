import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WorkDomain, WorkPayload, WorkProjectCard } from '@/lib/api';
import { ToastProvider } from '@/components/toast/ToastProvider';
import { WorkView } from './work-view';
import { WORK_OPEN_COOKIE, openCookieString, parseOpenCookie } from './browse-state';

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
function mount(data = payload, initialExpanded: string[] = []) {
  return render(
    <ToastProvider>
      <WorkView payload={data} tomorrowFocus={null} tomorrowDate="2026-09-20" initialExpanded={initialExpanded} />
    </ToastProvider>,
  );
}
// The card's disclosure control: the transparent button that fills the card,
// named by the domain title + the screen-reader cue.
function card(name: string, state: 'Show' | 'Hide' = 'Show') {
  return screen.getByRole('button', { name: `${name} ${state} contents` });
}
// The card's section, found via its name link so it works open or closed.
function section(name: string) { return screen.getByRole('link', { name }).closest('section')!; }

afterEach(() => {
  cleanup();
  document.cookie = `${WORK_OPEN_COOKIE}=;path=/;max-age=0`;
  vi.restoreAllMocks();
});

describe('compact domain browsing', () => {
  it('starts collapsed with counts on the card, panel associations and no sidebar facets', () => {
    mount();
    for (const d of payload.domains) {
      const button = card(d.name);
      expect(button.getAttribute('aria-expanded')).toBe('false');
      const panel = document.getElementById(button.getAttribute('aria-controls')!);
      expect(panel?.hidden).toBe(true);
      const sec = section(d.name);
      expect(sec.textContent).toContain('3 open');
      expect(sec.textContent).toContain('1 overdue');
      expect(sec.textContent).toContain('2 waiting');
    }
    expect(screen.queryByRole('link', { name: 'Service brakes' })).toBeNull();
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.queryByText('Status')).toBeNull();
  });

  it('links the name to the domain page from the collapsed card', () => {
    mount();
    const name = screen.getByRole('link', { name: 'Household' });
    expect(name.getAttribute('href')).toBe('/domains/Household');
    // The name is a link, not part of the disclosure button.
    expect(name.closest('button')).toBeNull();
    expect(card('Household').getAttribute('aria-expanded')).toBe('false');
  });

  it('deals cards into two columns in reading order', () => {
    mount();
    const board = screen.getByLabelText('Active domains');
    expect(board.children).toHaveLength(2);
    const left = board.children[0] as HTMLElement;
    const right = board.children[1] as HTMLElement;
    expect(within(left).getByRole('link', { name: 'Household' })).toBeDefined();
    expect(within(left).getByRole('link', { name: 'Empty' })).toBeDefined();
    expect(within(right).getByRole('link', { name: 'Creative work' })).toBeDefined();
    // `order` carries the payload index so the single mobile column reads row-wise.
    expect(section('Creative work').style.order).toBe('1');
    expect(section('Empty').style.order).toBe('2');
  });

  it('supports Enter/Space, independent cards, explicit navigation and asset hierarchy', async () => {
    const user = userEvent.setup();
    mount();
    const button = card('Household');
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
    // The panel lives inside the card's own section (its column), not beside it.
    expect(section('Household').contains(assetGroup)).toBe(true);
    await user.click(card('Creative work'));
    expect(button.getAttribute('aria-expanded')).toBe('true');
    button.focus();
    await user.keyboard(' ');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('link', { name: /Service brakes/ })).toBeNull();
    expect(card('Creative work', 'Hide').getAttribute('aria-expanded')).toBe('true');
  });

  it('searches children without discarding siblings or expansion state', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(card('Household'));
    await user.type(screen.getByRole('searchbox'), 'brakes');
    expect(screen.queryByRole('button', { name: 'Creative work Show contents' })).toBeNull();
    expect(screen.getByRole('link', { name: /Kitchen refresh/ })).toBeDefined();
    expect(screen.getByRole('group', { name: 'Family car' })).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(card('Creative work')).toBeDefined();
    expect(card('Household', 'Hide')).toBeDefined();
    await user.type(screen.getByRole('searchbox'), 'no-such-domain');
    expect(screen.getByRole('status').textContent).toContain('No domains match');
  });

  it('keeps empty domains navigable and parked domains independently expandable', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(card('Empty'));
    expect(screen.getByText('Nothing open.')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Open domain: Empty' })).toBeDefined();
    await user.type(screen.getByRole('searchbox'), 'Someday');
    expect(screen.getByRole('status').textContent).toContain('Parked below');
    const parked = screen.getByRole('button', { name: 'Parked (1)' });
    await user.click(parked);
    expect(parked.getAttribute('aria-expanded')).toBe('true');
    expect(card('Someday').getAttribute('aria-expanded')).toBe('false');
    await user.click(card('Someday'));
    expect(screen.getByRole('link', { name: 'Open domain: Someday' })).toBeDefined();
  });

  it('renders server-provided open cards on first paint and writes the cookie on toggle', () => {
    const view = mount(payload, ['Creative work']);
    expect(card('Creative work', 'Hide').getAttribute('aria-expanded')).toBe('true');
    expect(card('Household').getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(card('Household'));
    expect(parseOpenCookie(document.cookie.split('; ').find((c) => c.startsWith(`${WORK_OPEN_COOKIE}=`))?.split('=')[1]))
      .toEqual(['Creative work', 'Household']);
    fireEvent.click(card('Creative work', 'Hide'));
    expect(parseOpenCookie(document.cookie.split('; ').find((c) => c.startsWith(`${WORK_OPEN_COOKIE}=`))?.split('=')[1]))
      .toEqual(['Household']);
    view.unmount();
    // The page component turns that cookie back into initialExpanded.
    mount(payload, ['Household']);
    expect(card('Household', 'Hide').getAttribute('aria-expanded')).toBe('true');
  });

  it('round-trips ids through the cookie and survives a mangled value', () => {
    const ids = ['3f2b9c1e-0000-4000-8000-000000000001', 'Household'];
    const value = openCookieString(ids).split(';')[0]!.split('=')[1];
    expect(parseOpenCookie(value)).toEqual(ids);
    expect(parseOpenCookie(undefined)).toEqual([]);
    expect(parseOpenCookie('')).toEqual([]);
    expect(parseOpenCookie('%E0%A4%A')).toEqual([]);
  });
});

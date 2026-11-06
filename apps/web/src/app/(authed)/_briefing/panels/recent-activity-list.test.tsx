import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import type { RecentActivityEntry } from '@/lib/api';
import { RecentActivityList } from './recent-activity-list';

afterEach(cleanup);

const entries: RecentActivityEntry[] = Array.from({ length: 9 }, (_, i) => ({
  id: `task_added:${i}`,
  kind: 'task_added',
  label: 'Added',
  title: `Task ${i + 1}`,
  href: `/tasks/${i}`,
  location: { label: 'Inbox', inbox: true },
  detail: null,
  at: '2026-11-05T16:42:00Z',
  day: i < 8 ? '2026-11-05' : '2026-11-04',
  day_label: i < 8 ? 'Today · Thu Nov 5' : 'Yesterday · Wed Nov 4',
  time_label: i === 7 ? null : '10:42 AM',
}));

it('expands and collapses the timeline without repeating a day header', async () => {
  const user = userEvent.setup();
  render(<RecentActivityList entries={entries} />);
  expect(screen.getAllByRole('link')).toHaveLength(6);
  const toggle = screen.getByRole('button', { name: 'Show 3 more ↓' });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');

  await user.click(toggle);
  const links = screen.getAllByRole('link');
  expect(links.map((link) => link.getAttribute('href'))).toEqual(entries.map((entry) => entry.href));
  expect(screen.getAllByRole('heading', { name: 'Today · Thu Nov 5' })).toHaveLength(1);
  expect(screen.getByRole('heading', { name: 'Yesterday · Wed Nov 4' })).toBeDefined();
  expect(screen.getByText('—')).toBeDefined();
  expect(screen.getByRole('button', { name: 'Show fewer ↑' }).getAttribute('aria-expanded')).toBe('true');

  await user.click(toggle);
  expect(screen.getAllByRole('link')).toHaveLength(6);
});

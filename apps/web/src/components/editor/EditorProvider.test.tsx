import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorProvider, useEditorNavigation } from './EditorProvider';
import { TasksView } from '@/app/(authed)/tasks/tasks-view';

const router = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  return { useRouter: () => router, usePathname: () => useSyncExternalStore(
    callback => { window.addEventListener('popstate', callback); return () => window.removeEventListener('popstate', callback); },
    () => location.pathname,
  ) };
});
vi.mock('@/app/(authed)/today/actions', () => ({ toggleTaskDoneAction: vi.fn() }));
vi.mock('@/components/task-workflows/actions', () => ({ changeWorkflowStatus: vi.fn() }));
function subscribe(callback: () => void) {
  window.addEventListener('popstate', callback);
  return () => window.removeEventListener('popstate', callback);
}
function navigate(path: string) {
  history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
function Pages() {
  const path = useSyncExternalStore(subscribe, () => location.pathname);
  const navigation = useEditorNavigation()!;
  if (path === '/tasks/task') return <main><h1>Task detail</h1><p data-testid="origin">{navigation.origin()?.href ?? 'none'}</p>
    <button onClick={() => navigation.returnTo(navigation.origin()?.href ?? '/tasks')}>Return after deletion</button></main>;
  return <><TasksView tasks={[]} today="2026-09-21" tz="Pacific/Auckland" />
    <Link href="/tasks/task" onClick={e => { e.preventDefault(); navigate('/tasks/task'); }}>Open task</Link></>;
}
beforeEach(() => {
  sessionStorage.clear(); vi.clearAllMocks();
  history.replaceState({}, '', '/tasks?filter=project#items');
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  router.replace.mockImplementation((href: string) => {
    history.replaceState({}, '', href);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
});
afterEach(cleanup);

describe('editor origin and view restoration', () => {
  it('restores real All Tasks filters when returning from a task, preserving query and hash', async () => {
    const user = userEvent.setup();
    render(<EditorProvider scope="owner"><Pages /></EditorProvider>);
    await user.type(screen.getByRole('searchbox'), 'brakes');
    await user.click(screen.getByRole('link', { name: 'Open task' }));
    expect(screen.getByTestId('origin').textContent).toBe('/tasks?filter=project#items');
    await user.click(screen.getByRole('button', { name: 'Return after deletion' }));
    await waitFor(() => expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('brakes'));
    expect(location.pathname + location.search + location.hash).toBe('/tasks?filter=project#items');
  });
  it('treats a fresh direct task entry as having no known origin', () => {
    history.replaceState({}, '', '/tasks/task');
    render(<EditorProvider scope="owner"><Pages /></EditorProvider>);
    expect(screen.getByTestId('origin').textContent).toBe('none');
  });
  it('does not reuse another account’s history or saved list state', () => {
    history.replaceState({ jeviNavigation: { scope: 'old-user', href: '/tasks/task', key: 'old', origin: { href: '/projects/private', scrollY: 100 } } }, '', '/tasks/task');
    sessionStorage.setItem('jevi.editor-navigation:old-user', JSON.stringify({ views: { 'old:tasks:': { q: 'private filter' } } }));
    render(<EditorProvider scope="owner"><Pages /></EditorProvider>);
    expect(screen.getByTestId('origin').textContent).toBe('none');
    expect(sessionStorage.getItem('jevi.editor-navigation:old-user')).toBeNull();
  });
});

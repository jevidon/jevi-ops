import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { useLeaveGuard } from './use-leave-guard';

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
// jsdom cannot navigate. Swallow any click the guard lets through, in the
// bubble phase, after the guard's capture-phase listener has had its say.
const swallow = (event: Event) => event.preventDefault();
afterEach(() => { cleanup(); document.removeEventListener('click', swallow); });
beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState({ next: 'metadata' }, '', '/task-templates/abc');
  document.addEventListener('click', swallow);
});

function Harness({ dirty }: { dirty: boolean }) {
  const guard = useLeaveGuard(dirty, '/task-templates');
  return <div>
    <a href="/work">Domains</a>
    <a href="/task-templates/abc#notes">Same page</a>
    <a href="https://example.com/">Elsewhere</a>
    <a href="/tasks" target="_blank" rel="noreferrer">New tab</a>
    <button type="button" onClick={guard.allow}>Allow</button>
    {guard.dialog}
  </div>;
}
const unload = () => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; };
const asking = () => screen.queryByRole('alertdialog');
// The guard stops propagation when it steps in, so the click never bubbles.
function intercepted(name: string, init?: MouseEventInit) {
  let bubbled = false;
  const seen = () => { bubbled = true; };
  document.addEventListener('click', seen);
  fireEvent.click(screen.getByRole('link', { name }), init);
  document.removeEventListener('click', seen);
  return !bubbled;
}

it('stays out of the way while the draft is clean', () => {
  render(<Harness dirty={false} />);
  expect(unload()).toBe(false);
  expect(window.history.state).toEqual({ next: 'metadata' });
  // A clean page never blocks a link: the click reaches the router untouched.
  expect(intercepted('Domains')).toBe(false);
  expect(asking()).toBeNull();
});

it('asks before an in-app link discards a dirty draft, and leaves only on Discard', async () => {
  const user = userEvent.setup();
  render(<Harness dirty />);
  expect(unload()).toBe(true);
  expect(intercepted('Domains')).toBe(true);
  expect(screen.getByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep editing' }));
  await user.click(screen.getByRole('button', { name: 'Keep editing' }));
  expect(asking()).toBeNull();
  expect(replace).not.toHaveBeenCalled();
  expect(intercepted('Domains')).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Discard changes' }));
  expect(replace).toHaveBeenCalledWith('/work');
  expect(asking()).toBeNull();
  // Discarding is a decision to leave: nothing asks again on the way out.
  expect(unload()).toBe(false);
});

it('ignores clicks that do not leave this page in this tab', () => {
  render(<Harness dirty />);
  expect(intercepted('Domains', { metaKey: true })).toBe(false);
  expect(intercepted('Domains', { button: 1 })).toBe(false);
  expect(intercepted('Same page')).toBe(false);
  expect(intercepted('New tab')).toBe(false);
  // Another origin unloads the document; beforeunload covers that exit.
  expect(intercepted('Elsewhere')).toBe(false);
  expect(asking()).toBeNull();
});

it('answers Back while dirty by staying on the page and asking', async () => {
  const user = userEvent.setup();
  const { rerender } = render(<Harness dirty={false} />);
  rerender(<Harness dirty />);
  // Becoming dirty adds a same-URL entry that keeps the router's own metadata.
  expect(window.history.state).toMatchObject({ next: 'metadata', jeviLeaveGuard: expect.any(String) });
  const marker = window.history.state.jeviLeaveGuard;
  window.history.back();
  await waitFor(() => expect(asking()).toBeTruthy());
  expect(location.pathname).toBe('/task-templates/abc');
  expect(window.history.state.jeviLeaveGuard).toBe(marker);
  const go = vi.spyOn(window.history, 'go').mockImplementation(() => {});
  await user.click(screen.getByRole('button', { name: 'Discard changes' }));
  expect(go).toHaveBeenCalledWith(-2);
  // Opened directly, there is nothing two entries back: fall back to the library.
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/task-templates'));
  go.mockRestore();
});

it('lets one Back press leave once the draft is clean again', async () => {
  const { rerender } = render(<Harness dirty />);
  rerender(<Harness dirty={false} />);
  const back = vi.spyOn(window.history, 'back');
  window.history.back();
  await waitFor(() => expect(back).toHaveBeenCalledTimes(2));
  expect(asking()).toBeNull();
  back.mockRestore();
});

it('stands down after allow(), for a save that navigates on purpose', async () => {
  const user = userEvent.setup();
  render(<Harness dirty />);
  await user.click(screen.getByRole('button', { name: 'Allow' }));
  expect(unload()).toBe(false);
  expect(intercepted('Domains')).toBe(false);
  expect(asking()).toBeNull();
});

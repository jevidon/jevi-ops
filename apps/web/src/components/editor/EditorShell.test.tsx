import { useActionState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditDrawer } from '@/components/detail/EditDrawer';
import { ToastProvider } from '@/components/toast/ToastProvider';
import { EditorForm } from './EditorForm';
import { EditorProvider } from './EditorProvider';
import type { EditorResult } from './EditorShell';

const router = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/tasks/task' }));

function TestForm({ save, remove }: { save: (data: FormData) => Promise<EditorResult>; remove?: () => Promise<EditorResult> }) {
  const [result, action] = useActionState<EditorResult | null, FormData>((_, data) => save(data), null);
  return <EditorForm action={action} result={result} deleteAction={remove} deleteDescription="Delete Brakes permanently?">
    <label>Title<input required name="title" defaultValue="Brakes" /></label>
    <label>Notes<textarea name="notes" defaultValue="Keep these notes" /></label>
  </EditorForm>;
}
function mount(save = vi.fn<(data: FormData) => Promise<EditorResult>>(async () => ({ ok: true })), remove?: () => Promise<EditorResult>) {
  render(<ToastProvider><EditorProvider scope="test-user"><EditDrawer title="Edit task" managed><TestForm save={save} remove={remove} /></EditDrawer></EditorProvider></ToastProvider>);
  return save;
}
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear();
  window.history.replaceState({}, '', '/tasks/task');
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(cleanup);

describe('shared editor lifecycle', () => {
  it('submits the intended form from the header and closes only after successful save', async () => {
    const user = userEvent.setup(); const save = mount();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.clear(screen.getByRole('textbox', { name: 'Title' }));
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'New title');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0].get('title')).toBe('New title');
    expect(router.refresh).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit' }));
  });
  it('retains uncontrolled fields on a failed save and allows retry', async () => {
    const user = userEvent.setup();
    const save = vi.fn<(data: FormData) => Promise<EditorResult>>().mockResolvedValueOnce({ ok: false, error: 'Server unavailable' }).mockResolvedValueOnce({ ok: true });
    mount(save);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.type(screen.getByRole('textbox', { name: 'Notes' }), ' plus new draft');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('alert');
    expect((screen.getByRole('textbox', { name: 'Notes' }) as HTMLTextAreaElement).value).toBe('Keep these notes plus new draft');
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(save).toHaveBeenCalledTimes(2);
  });
  it('guards Cancel and Escape and treats reverted changes as clean', async () => {
    const user = userEvent.setup(); mount();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.type(screen.getByRole('textbox', { name: 'Title' }), '!');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('alertdialog')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect((screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement).value).toBe('Brakes!');
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(screen.getByRole('alertdialog')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    await user.clear(screen.getByRole('textbox', { name: 'Title' }));
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Brakes');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  it('never deletes until confirmation and keeps the draft when deletion fails', async () => {
    const user = userEvent.setup();
    const remove = vi.fn(async (): Promise<EditorResult> => ({ ok: false, error: 'Deletion failed' }));
    mount(undefined, remove);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.type(screen.getByRole('textbox', { name: 'Title' }), ' edited');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent(screen.getByRole('alertdialog'), new Event('cancel', { cancelable: true, bubbles: true }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }));
    expect((await within(screen.getByRole('alertdialog')).findByRole('alert')).textContent).toBe('Deletion failed');
    expect(remove).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Cancel deletion' }));
    expect((screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement).value).toBe('Brakes edited');
    expect(router.replace).not.toHaveBeenCalled();
  });
  it('prevents editing and duplicate mutations while a save is pending', async () => {
    const user = userEvent.setup();
    let finish!: (result: EditorResult) => void;
    const save = vi.fn(() => new Promise<EditorResult>(resolve => { finish = resolve; }));
    const remove = vi.fn(async (): Promise<EditorResult> => ({ ok: true }));
    mount(save, remove);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect((screen.getByRole('button', { name: 'Saving…' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('textbox', { name: 'Title' }).closest('fieldset')?.disabled).toBe(true);
    finish({ ok: true });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(save).toHaveBeenCalledOnce(); expect(remove).not.toHaveBeenCalled();
  });
  it('closes cleanly on Back and asks before abandoning a dirty editor', async () => {
    const user = userEvent.setup(); mount();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.type(screen.getByRole('textbox', { name: 'Title' }), ' changed');
    window.history.back();
    await screen.findByRole('alertdialog');
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(location.pathname).toBe('/tasks/task');
  });
  it('runs the post-delete navigation once even if navigation emits another history event', async () => {
    const user = userEvent.setup();
    router.replace.mockImplementationOnce((href: string) => {
      history.replaceState({}, '', href);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    mount(undefined, async () => ({ ok: true, redirectTo: '/projects/project?group=milestone' }));
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(router.replace).toHaveBeenCalledExactlyOnceWith('/projects/project?group=milestone', { scroll: false });
  });
});

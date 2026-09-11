import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DocEditor } from './DocEditor';

// Editor behaviour only a DOM can exercise (review of #43, finding 7):
// nothing typed during a save is lost, saves are serialised, and a Next
// link away from a dirty draft asks first.

vi.mock('./doc-actions', () => ({
  saveDocAction: vi.fn(),
  listDocRevisionsAction: vi.fn(async () => []),
  promoteChecklistLineAction: vi.fn(),
}));

import { saveDocAction } from './doc-actions';
const saveMock = vi.mocked(saveDocAction);

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DocEditor', () => {
  it('keeps text typed during an in-flight save and stays open on it', async () => {
    const pending = deferred<{ ok: true; doc_md: string; doc_version: number }>();
    saveMock.mockReturnValueOnce(pending.promise);
    const onSaved = vi.fn();
    render(<DocEditor entity="asset" id="a1" initialBody="" initialVersion={1} onSaved={onSaved} onCancel={() => {}} />);
    const box = screen.getByLabelText('Overview') as HTMLTextAreaElement;

    fireEvent.change(box, { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    expect(saveMock.mock.calls[0]![0]).toMatchObject({ body: 'hello', version: 1 });

    // Keep typing while the request is out.
    fireEvent.change(box, { target: { value: 'hello world' } });
    pending.resolve({ ok: true, doc_md: 'hello', doc_version: 2 });

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('hello', 2, true));
    expect(box.value).toBe('hello world');
    expect(screen.getByRole('status').textContent).toMatch(/still unsaved/);
    // The newer text saves against the new version.
    saveMock.mockResolvedValueOnce({ ok: true, doc_md: 'hello world', doc_version: 3 });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('hello world', 3, false));
    expect(saveMock.mock.calls[1]![0]).toMatchObject({ body: 'hello world', version: 2 });
  });

  it('serialises saves: a second ⌘S while one is pending is ignored', async () => {
    const pending = deferred<{ ok: true; doc_md: string; doc_version: number }>();
    saveMock.mockReturnValueOnce(pending.promise);
    render(<DocEditor entity="asset" id="a1" initialBody="" initialVersion={1} onSaved={() => {}} onCancel={() => {}} />);
    const box = screen.getByLabelText('Overview');
    fireEvent.change(box, { target: { value: 'x' } });
    fireEvent.keyDown(box, { key: 's', metaKey: true });
    fireEvent.keyDown(box, { key: 's', metaKey: true });
    fireEvent.click(screen.getByRole('button', { name: /Sav/ }));
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    pending.resolve({ ok: true, doc_md: 'x', doc_version: 2 });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeDefined());
    expect(saveMock).toHaveBeenCalledTimes(1);
  });

  it('asks before a client-side link leaves a dirty draft', () => {
    render(<DocEditor entity="asset" id="a1" initialBody="" initialVersion={1} onSaved={() => {}} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText('Overview'), { target: { value: 'unsaved' } });
    const link = document.createElement('a');
    link.href = '/elsewhere';
    link.textContent = 'Elsewhere';
    document.body.appendChild(link);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(event);
    expect(confirm).toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    confirm.mockReturnValue(true);
    // Observe the guard's verdict at the document level, then stop jsdom
    // from actually navigating (it can't, and says so loudly).
    let allowed: boolean | null = null;
    const observe = (e: Event) => {
      allowed = !e.defaultPrevented;
      e.preventDefault();
    };
    document.addEventListener('click', observe);
    const again = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(again);
    document.removeEventListener('click', observe);
    expect(allowed).toBe(true);
    link.remove();
  });
});

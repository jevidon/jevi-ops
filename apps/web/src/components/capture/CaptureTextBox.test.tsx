import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { CaptureTextBox } from './CaptureTextBox';

// The receipt must be visible before interpretation finishes (review R01):
// a model that hangs forever cannot delay "Saved to Jevi Ops", and a failed
// save keeps the draft and the same ids for the next attempt.

const actions = vi.hoisted(() => ({ save: vi.fn(), interpret: vi.fn() }));
vi.mock('@/lib/capture-actions', () => ({ saveTextCapture: actions.save, interpretSavedCapture: actions.interpret }));

function Host() {
  const [text, setText] = useState('call the plumber');
  return <CaptureTextBox text={text} onTextChange={setText} />;
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('CaptureTextBox two-step save', () => {
  it('shows the storage receipt while interpretation never resolves', async () => {
    actions.save.mockResolvedValue({ kind: 'server_saved', captureId: 'cap-1', message: 'Saved to Jevi Ops.' });
    actions.interpret.mockReturnValue(new Promise(() => {})); // hung model
    render(<Host />);
    fireEvent.click(screen.getByText('Capture'));
    expect(await screen.findByText('Saved to Jevi Ops.')).toBeTruthy();
    expect(screen.getByText('Saved · interpreting…')).toBeTruthy();
    expect(actions.save).toHaveBeenCalledOnce();
    expect(actions.interpret).toHaveBeenCalledWith('cap-1');
    // The draft cleared on the receipt, not on the interpretation.
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
    expect(screen.getByRole('link', { name: 'Open in Inbox' }).getAttribute('href')).toBe('/inbox/captures/cap-1');
  });

  it('updates the same chip when interpretation completes', async () => {
    actions.save.mockResolvedValue({ kind: 'server_saved', captureId: 'cap-2', message: 'Saved to Jevi Ops.' });
    actions.interpret.mockResolvedValue({ kind: 'executed', summary: '✓ 1 done', details: [] });
    render(<Host />);
    fireEvent.click(screen.getByText('Capture'));
    expect(await screen.findByText('✓ 1 done')).toBeTruthy();
  });

  it('keeps the draft and reuses the ids when the save fails', async () => {
    actions.save.mockResolvedValueOnce({ kind: 'save_failed', message: 'Could not save: network_error' });
    actions.save.mockResolvedValueOnce({ kind: 'server_saved', captureId: 'cap-3', message: 'Saved to Jevi Ops.' });
    actions.interpret.mockResolvedValue({ kind: 'pending', captureId: 'cap-3', message: 'Saved to Jevi Ops. Interpretation is pending — see Inbox › Captures.', state: 'blocked', errorCode: 'llm_unavailable' });
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'Capture' }));
    expect(await screen.findByText('Could not save: network_error')).toBeTruthy();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('call the plumber');
    fireEvent.click(screen.getByRole('button', { name: 'Capture' }));
    await waitFor(() => expect(actions.save).toHaveBeenCalledTimes(2));
    const [firstIds] = actions.save.mock.calls[0]!.slice(1) as [{ operationId: string; captureId: string; capturedAt: string }];
    const [secondIds] = actions.save.mock.calls[1]!.slice(1) as [{ operationId: string; captureId: string; capturedAt: string }];
    expect(secondIds).toEqual(firstIds);
    expect(firstIds.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await screen.findByText(/Interpretation is pending/)).toBeTruthy();
  });
});

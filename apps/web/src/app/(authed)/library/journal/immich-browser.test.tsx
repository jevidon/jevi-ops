import { StrictMode, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImmichCandidate } from '@/lib/api';
import { ImmichBrowser } from './immich-browser';
import { loadImmichCandidatesAction } from './[id]/actions';

vi.mock('./[id]/actions', () => ({ loadImmichCandidatesAction: vi.fn() }));

const candidates: [ImmichCandidate, ImmichCandidate] = [
  { id: 'landed', taken_at: '2026-09-21T10:00:00Z', thumb_url: '/landed.jpg' },
  { id: 'retry', taken_at: '2026-09-21T11:00:00Z', thumb_url: '/retry.jpg' },
];

function SelectionParent({ attachedIds = [], entryDate = '2026-09-21' }: {
  attachedIds?: string[];
  entryDate?: string;
}) {
  const [ids, setIds] = useState<string[]>([]);
  return (
    <ImmichBrowser
      entryDate={entryDate}
      attachedIds={attachedIds}
      onSelectionChange={(next) => setIds(next)}
      footer={<output data-testid="selection">{ids.join(',')}</output>}
    />
  );
}

beforeEach(() => {
  vi.mocked(loadImmichCandidatesAction).mockResolvedValue({
    ok: true, configured: true, candidates,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

describe('ImmichBrowser selection', () => {
  it('removes attached photos, keeps failed photos selected, and updates the parent without render warnings', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = render(<StrictMode><SelectionParent /></StrictMode>);
    fireEvent.click(await screen.findByTitle(candidates[0].taken_at));
    fireEvent.click(screen.getByTitle(candidates[1].taken_at));
    expect(screen.getByTestId('selection').textContent).toBe('landed,retry');

    rerender(<StrictMode><SelectionParent attachedIds={['landed']} /></StrictMode>);

    await waitFor(() => expect(screen.getByTestId('selection').textContent).toBe('retry'));
    expect((screen.getByTitle(candidates[0].taken_at) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTitle(candidates[1].taken_at) as HTMLButtonElement).disabled).toBe(false);
    expect(error).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTitle(candidates[1].taken_at));
    expect(screen.getByTestId('selection').textContent).toBe('');
  });

  it('clears the parent selection when browsing days and when the committed date changes', async () => {
    const { rerender } = render(<StrictMode><SelectionParent /></StrictMode>);
    fireEvent.click(await screen.findByTitle(candidates[0].taken_at));
    expect(screen.getByTestId('selection').textContent).toBe('landed');

    fireEvent.click(screen.getByRole('button', { name: 'Browse previous day' }));
    await waitFor(() => expect(screen.getByTestId('selection').textContent).toBe(''));
    expect(loadImmichCandidatesAction).toHaveBeenLastCalledWith('2026-09-20');

    fireEvent.click(screen.getByTitle(candidates[1].taken_at));
    expect(screen.getByTestId('selection').textContent).toBe('retry');
    rerender(<StrictMode><SelectionParent entryDate="2026-09-22" /></StrictMode>);
    await waitFor(() => expect(screen.getByTestId('selection').textContent).toBe(''));
    expect(loadImmichCandidatesAction).toHaveBeenLastCalledWith('2026-09-22');
  });
});

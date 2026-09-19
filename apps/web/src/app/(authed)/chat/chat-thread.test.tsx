import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ChatThread } from './chat-thread';
import { askAction } from './actions';

vi.mock('./actions', () => ({ askAction: vi.fn(), transcribeAudioAction: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

describe('ChatThread', () => {
  it('submits consecutive questions and preserves their answers without native randomUUID', async () => {
    // HTTP LAN/Tailscale origins expose getRandomValues, but not randomUUID.
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    // jsdom does not implement scrolling.
    const scrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    vi.mocked(askAction)
      .mockResolvedValueOnce({ ok: true, response: { question: 'First question', answer: 'First answer', tool_trace: [], turns: 1 } })
      .mockResolvedValueOnce({ ok: true, response: { question: 'Second question', answer: 'Second answer', tool_trace: [], turns: 1 } });

    try {
      render(<ChatThread />);
      const input = screen.getByRole('textbox') as HTMLTextAreaElement;
      fireEvent.change(input, { target: { value: '  First question  ' } });
      fireEvent.click(screen.getByRole('button', { name: 'Ask' }));

      expect(await screen.findByText('First answer')).toBeTruthy();
      expect(input.value).toBe('');
      expect(askAction).toHaveBeenNthCalledWith(1, [{ role: 'user', content: 'First question' }]);

      fireEvent.change(input, { target: { value: 'Second question' } });
      fireEvent.click(screen.getByRole('button', { name: 'Ask' }));

      expect(await screen.findByText('Second answer')).toBeTruthy();
      expect(screen.getByText('First answer')).toBeTruthy();
      expect(askAction).toHaveBeenNthCalledWith(2, [
        { role: 'user', content: 'First question' },
        { role: 'assistant', content: 'First answer' },
        { role: 'user', content: 'Second question' },
      ]);
    } finally {
      if (scrollIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollIntoView);
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    }
  });
});

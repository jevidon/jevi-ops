import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AppSettings, ModelDiscoveryResult } from '@/lib/api';
import { AiSettingsForm } from './ai-settings-form';

const actions = vi.hoisted(() => ({ discover: vi.fn(), save: vi.fn(), testLlm: vi.fn(), testStt: vi.fn() }));
vi.mock('./actions', () => ({
  discoverLlmModelsAction: actions.discover,
  updateIntegrationSettingsAction: actions.save,
  testLlmAction: actions.testLlm,
  testSttAction: actions.testStt,
}));

const current: AppSettings = {
  timezone: 'Pacific/Auckland', health_module_enabled: false, routines_module_enabled: true,
  rule_module_enabled: false, maintenance_module_enabled: true,
  llm_provider: 'openai_compatible', llm_base_url: 'http://127.0.0.1:8080/v1', llm_model: '',
};
const single: ModelDiscoveryResult = {
  ok: true, base_url: current.llm_base_url!, models: ['mlx-community/Qwen3.5-9B-MLX-4bit'],
  loaded: ['mlx-community/Qwen3.5-9B-MLX-4bit'],
};
const modelInput = () => screen.getByLabelText('Model', { selector: 'input[id]' }) as HTMLInputElement;
const saveButton = () => screen.getByRole('button', { name: 'Save LLM' }) as HTMLButtonElement;
function deferDiscovery() {
  let resolve!: (value: ModelDiscoveryResult) => void;
  actions.discover.mockReturnValue(new Promise<ModelDiscoveryResult>((done) => { resolve = done; }));
  return resolve;
}

beforeEach(() => {
  actions.discover.mockResolvedValue(single);
  actions.save.mockResolvedValue({ ok: true, message: 'Saved.' });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('LLM model discovery', () => {
  it('auto-discovers once on mount, labels the loaded model and saves its plain ID', async () => {
    render(<StrictMode><AiSettingsForm current={current} /></StrictMode>);
    await waitFor(() => expect(modelInput().value).toBe(single.models[0]));
    expect(actions.discover).toHaveBeenCalledExactlyOnceWith(current.llm_base_url);
    expect(document.querySelector('datalist option')?.getAttribute('label')).toBe(`${single.models[0]} (loaded)`);
    expect(modelInput().getAttribute('list')).toBe(document.querySelector('datalist')?.id);
    fireEvent.click(saveButton());
    await waitFor(() => expect(actions.save).toHaveBeenCalledWith(expect.objectContaining({ llm_model: single.models[0] })));
  });

  it('offers multiple suggestions while preserving the current model and allowing a custom value', async () => {
    actions.discover.mockResolvedValue({ ok: true, base_url: current.llm_base_url, models: ['a', 'b'] });
    render(<AiSettingsForm current={{ ...current, llm_model: 'existing' }} />);
    expect(actions.discover).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Discover models' }));
    await screen.findByText('Choose a discovered model or enter a custom model ID.');
    expect(modelInput().value).toBe('existing');
    expect(document.querySelectorAll('datalist option')).toHaveLength(2);
    fireEvent.change(modelInput(), { target: { value: 'custom/model' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(actions.save).toHaveBeenCalledWith(expect.objectContaining({ llm_model: 'custom/model' })));
  });

  it('keeps Save enabled while probing and preserves text when discovery fails', async () => {
    const resolve = deferDiscovery();
    render(<AiSettingsForm current={{ ...current, llm_model: 'custom' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Discover models' }));
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());
    await waitFor(() => expect(actions.save).toHaveBeenCalledWith(expect.objectContaining({ llm_model: 'custom' })));
    await act(async () => resolve({ ok: false, error: 'discover_timeout', detail: 'Timed out.' }));
    expect(await screen.findByText('server unreachable: Timed out.')).toBeTruthy();
    expect(modelInput().value).toBe('custom');
    expect(modelInput().hasAttribute('list')).toBe(false);
    expect(saveButton().disabled).toBe(false);
    fireEvent.change(modelInput(), { target: { value: 'another/custom' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(actions.save).toHaveBeenLastCalledWith(expect.objectContaining({ llm_model: 'another/custom' })));
  });

  it('preserves a custom value typed while automatic discovery is in flight', async () => {
    const resolve = deferDiscovery();
    render(<AiSettingsForm current={current} />);
    fireEvent.change(modelInput(), { target: { value: 'typed-during-probe' } });
    await act(async () => resolve(single));
    expect(modelInput().value).toBe('typed-during-probe');
    expect(document.querySelectorAll('datalist option')).toHaveLength(1);
  });

  it.each(['url', 'provider'])('discards a stale result after the %s changes', async (field) => {
    const resolve = deferDiscovery();
    render(<AiSettingsForm current={current} />);
    if (field === 'url') {
      fireEvent.change(screen.getByLabelText('Base URL (OpenAI-compatible)'), { target: { value: 'http://other:8080/v1' } });
    } else {
      fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'anthropic' } });
    }
    await act(async () => resolve(single));
    expect(modelInput().value).toBe('');
    expect(document.querySelector('datalist')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('clears suggestions when the base URL changes', async () => {
    render(<AiSettingsForm current={current} />);
    await waitFor(() => expect(modelInput().value).toBe(single.models[0]));
    fireEvent.change(screen.getByLabelText('Base URL (OpenAI-compatible)'), { target: { value: 'http://other:8080/v1' } });
    expect(document.querySelector('datalist')).toBeNull();
    expect(modelInput().value).toBe(single.models[0]);
  });

  it('handles an empty list and permits custom input', async () => {
    actions.discover.mockResolvedValue({ ok: true, base_url: current.llm_base_url, models: [] });
    render(<AiSettingsForm current={current} />);
    expect(await screen.findByText('No models found. Enter a custom model ID.')).toBeTruthy();
    expect(modelInput().value).toBe('');
    expect(saveButton().disabled).toBe(false);
  });

  it('handles server-action transport failures inline', async () => {
    actions.discover.mockRejectedValue(new Error('Connection lost.'));
    render(<AiSettingsForm current={current} />);
    expect(await screen.findByText('server unreachable: Connection lost.')).toBeTruthy();
    expect(saveButton().disabled).toBe(false);
  });

  it('does not auto-discover for Anthropic or a blank base URL', () => {
    const view = render(<AiSettingsForm current={{ ...current, llm_provider: 'anthropic' }} />);
    expect(actions.discover).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Discover models' })).toBeNull();
    view.unmount();
    render(<AiSettingsForm current={{ ...current, llm_base_url: '' }} />);
    expect(actions.discover).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Discover models' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('supports discovery when the provider uses the environment default', async () => {
    render(<AiSettingsForm current={{ ...current, llm_provider: null }} />);
    await waitFor(() => expect(modelInput().value).toBe(single.models[0]));
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AiSettingsForm } from './ai-settings-form';
import type { AppSettings } from '@/lib/api';

const actions = vi.hoisted(() => ({ save: vi.fn(), llm: vi.fn(), stt: vi.fn(), immich: vi.fn() }));
vi.mock('./actions', () => ({ updateIntegrationSettingsAction: actions.save, testLlmAction: actions.llm, testSttAction: actions.stt, testImmichAction: actions.immich }));
const missing = { source: 'none' as const, configured: false, state: 'missing' as const, endpoint: null, allow_insecure: false };
const current: AppSettings = { revision: 7, timezone: 'UTC', currency: 'NZD', health_module_enabled: false, routines_module_enabled: true, rule_module_enabled: false, maintenance_module_enabled: true, meter_stale_days: 14, briefing_panels: null, agenda_image_url: null, agenda_data_url: null, llm_provider: 'openai_compatible', llm_base_url: 'http://127.0.0.1:8080/v1', llm_model: 'model', stt_base_url: null, stt_model: null, immich_base_url: null, credentials: { llm: { ...missing, source: 'managed', configured: true, state: 'ready', endpoint: 'http://127.0.0.1:8080/v1' }, stt: missing, immich: missing }, capabilities: {} };
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('safe integration settings editing', () => {
  it('never hydrates an existing key and tests entered candidate fields without saving', async () => {
    actions.llm.mockResolvedValue({ ok: false, message: 'authentication_failed' });
    render(<AiSettingsForm current={current} />);
    expect(screen.queryByLabelText('Language model new API key')).toBeNull();
    fireEvent.change(screen.getByLabelText('Language model credential action'), { target: { value: 'replace' } });
    fireEvent.change(screen.getByLabelText('Language model new API key'), { target: { value: 'new-user-secret' } });
    fireEvent.change(screen.getByLabelText('Language model model'), { target: { value: 'draft-model' } });
    fireEvent.click(screen.getByText('Test text'));
    await waitFor(() => expect(actions.llm).toHaveBeenCalledOnce());
    expect(actions.llm.mock.calls[0]?.[0]).toMatchObject({ candidate: { expected_revision: 7, llm_model: 'draft-model', llm_credential: { action: 'replace', value: 'new-user-secret' } } });
    expect(actions.save).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Language model new API key') as HTMLInputElement).value).toBe('new-user-secret');
    expect(await screen.findByText('authentication_failed')).toBeTruthy();
  });
  it('keeps edits on a revision conflict, and clears entered secrets only after a successful save', async () => {
    actions.save.mockResolvedValueOnce({ ok: false, message: 'settings_revision_conflict' });
    render(<AiSettingsForm current={current} />);
    fireEvent.change(screen.getByLabelText('Language model credential action'), { target: { value: 'replace' } });
    fireEvent.change(screen.getByLabelText('Language model new API key'), { target: { value: 'new-user-secret' } });
    fireEvent.click(screen.getByText('Save Language model'));
    await screen.findByText('settings_revision_conflict');
    expect((screen.getByLabelText('Language model new API key') as HTMLInputElement).value).toBe('new-user-secret');
    actions.save.mockResolvedValueOnce({ ok: true, message: 'Saved.', settings: { ...current, revision: 8 } });
    fireEvent.click(screen.getByText('Save Language model'));
    await screen.findByText('Saved.');
    expect(screen.queryByLabelText('Language model new API key')).toBeNull();
    actions.save.mockResolvedValueOnce({ ok: true, message: 'Cleared.', settings: { ...current, revision: 9 } });
    fireEvent.change(screen.getByLabelText('Language model credential action'), { target: { value: 'clear' } });
    fireEvent.click(screen.getByText('Save Language model'));
    await waitFor(() => expect(actions.save).toHaveBeenCalledTimes(3));
    expect(actions.save.mock.calls[2]?.[0]).toMatchObject({ expected_revision: 8, llm_credential: { action: 'clear' } });
  });
});

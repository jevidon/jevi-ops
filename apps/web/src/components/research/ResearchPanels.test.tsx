import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AssetResearchPanel } from './AssetResearchPanel';
import { MonitoringPanel } from './MonitoringPanel';
import { ResearchWorkersPanel } from './ResearchWorkersPanel';
import type { MonitoringPolicy, ResearchJob, ResearchProposal, ResearchWorker } from './types';
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
vi.mock('./actions', () => ({
  loadAssetResearchAction: vi.fn(), researchJobDetailAction: vi.fn(), requestVehicleResearchAction: vi.fn(), cancelResearchJobAction: vi.fn(),
  previewResearchProposalAction: vi.fn(), approveResearchProposalAction: vi.fn(), rejectResearchProposalAction: vi.fn(),
  loadResearchWorkersAction: vi.fn(), createHermesWorkerAction: vi.fn(), mintResearchWorkerTokenAction: vi.fn(), revokeResearchWorkerTokenAction: vi.fn(), updateResearchWorkerAction: vi.fn(),
  loadMonitoringPoliciesAction: vi.fn(), monitoringChoicesAction: vi.fn(), monitoringDetailAction: vi.fn(), saveMonitoringPolicyAction: vi.fn(), setMonitoringEnabledAction: vi.fn(), signalMonitoringAction: vi.fn(), readMonitoringNotificationAction: vi.fn(),
}));
import * as actions from './actions';
const worker: ResearchWorker = { id: 'worker-1', name: 'My Hermes worker', enabled: true, adapter: 'jevi-hermes', adapter_version: 'pinned-test', capabilities: ['external_fetch'], allowed_task_types: ['vehicle_question', 'responsibility_review', 'source_verification'], last_seen_at: '2026-09-11T01:00:00Z', last_health_ok: true, health_detail: 'Adapter reachable', last_successful_at: null, connection_state: 'configured_not_tested' };
const proposal: ResearchProposal = { id: 'proposal-1', asset_id: 'asset-1', job_id: 'job-1', operations: [{ type: 'profile_facts', facts: [{ key: 'make', expected: null, value: 'Toyota' }], citation_ids: ['source-1'], reason: 'A supported correction' }], status: 'pending_review', revision: 1, fingerprint: null, preview: null, reason: null, receipt: null };
const job = { id: 'job-1', asset_id: 'asset-1', request: { question: 'What is known about this vehicle?', max_attempts: 3 }, status: 'succeeded', attempts: 1, failure_reason: null, last_checked_at: '2026-09-11T01:00:00Z' } as ResearchJob;
const policy: MonitoringPolicy = { id: 'policy-1', revision: 4, config: { name: 'Vehicle rules', asset_ids: ['asset-1'], worker_id: worker.id, enabled: false, question: 'Check the published rule', allowed_domains: ['example.org'], cadence_hours: 720, budget: { timeout_seconds: 300, max_sources: 5, max_requests: 20 }, scope: { categories: ['regulatory'], rule_ids: [] }, notifications: 'meaningful_changes' }, next_due_at: '2026-09-12T00:00:00Z', retry_after_at: null, last_attempt_at: '2026-09-11T01:00:00Z', last_successful_at: null, last_outcome: 'failed', failure_count: 1, monitoring_state: 'paused', connection_state: 'configured_not_tested' };
beforeEach(() => {
  vi.mocked(actions.loadAssetResearchAction).mockResolvedValue({ ok: true, value: { workers: [worker], jobs: [], proposals: [] } });
  vi.mocked(actions.loadResearchWorkersAction).mockResolvedValue({ ok: true, value: { workers: [worker], tokens: [] } });
  vi.mocked(actions.loadMonitoringPoliciesAction).mockResolvedValue({ ok: true, value: { policies: [] } });
  vi.mocked(actions.monitoringChoicesAction).mockResolvedValue({ ok: true, value: { assets: [{ id: 'asset-1', name: 'My vehicle', kind: 'vehicle', lifecycle: 'active' }], rules: [] } });
  vi.mocked(actions.researchJobDetailAction).mockResolvedValue({ ok: true, value: { job, result: null, proposals: [], history: [] } });
  vi.mocked(actions.monitoringDetailAction).mockResolvedValue({ ok: true, value: { policy, runs: [], signals: [], notifications: [] } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); });

describe('bounded owner research', () => {
  it('preserves the scope and operation key across a connection retry', async () => {
    vi.mocked(actions.requestVehicleResearchAction).mockResolvedValueOnce({ ok: false, code: 'connection_failed', error: 'Connection interrupted' }).mockResolvedValueOnce({ ok: true, value: { job } });
    render(<AssetResearchPanel assetId="asset-1" />);
    await screen.findByText(/My Hermes worker: configured not tested/);
    fireEvent.click(screen.getByRole('button', { name: 'Request vehicle research' }));
    fireEvent.change(screen.getByLabelText('Research question'), { target: { value: 'Check this public rule https://example.org/rules' } });
    fireEvent.change(screen.getByLabelText('Permitted web domains'), { target: { value: 'EXAMPLE.ORG' } });
    fireEvent.change(screen.getByLabelText('Maximum web requests'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit bounded research request' }));
    await screen.findByText('Connection interrupted');
    fireEvent.click(screen.getByRole('button', { name: 'Submit bounded research request' }));
    await waitFor(() => expect(actions.requestVehicleResearchAction).toHaveBeenCalledTimes(2));
    const calls = vi.mocked(actions.requestVehicleResearchAction).mock.calls;
    expect(calls[1]![0]).toEqual(calls[0]![0]);
    expect(calls[0]![0].allowed_domains).toEqual(['example.org']);
    expect(calls[0]![0].budget?.max_requests).toBe(8);
    expect(actions.approveResearchProposalAction).not.toHaveBeenCalled();
  });

  it('requires concrete preview before approval and retains the same approval key on interrupted delivery', async () => {
    vi.mocked(actions.loadAssetResearchAction).mockResolvedValue({ ok: true, value: { workers: [worker], jobs: [], proposals: [proposal] } });
    vi.mocked(actions.previewResearchProposalAction).mockResolvedValue({ ok: true, value: { proposal: { ...proposal, revision: 2, fingerprint: 'a'.repeat(64), preview: { changes: [{ type: 'profile_facts', after: { make: 'Toyota', baseline: { hidden: 'private-internal-marker' } } }], summary: 'Correct the make', uncertainty: [], missing_facts: [] } } } });
    vi.mocked(actions.approveResearchProposalAction).mockResolvedValueOnce({ ok: false, code: 'connection_failed', error: 'Connection interrupted' }).mockResolvedValueOnce({ ok: false, code: 'research_conflict', error: 'Vehicle facts changed' });
    render(<AssetResearchPanel assetId="asset-1" />);
    await screen.findByRole('button', { name: 'Preview concrete changes' });
    expect(screen.queryByRole('button', { name: 'Approve and apply reviewed changes' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Preview concrete changes' }));
    await screen.findByRole('button', { name: 'Approve and apply reviewed changes' });
    expect(screen.queryByText('private-internal-marker')).toBeNull();
    expect(actions.approveResearchProposalAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Approve and apply reviewed changes' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Approve and apply reviewed changes' }));
    await waitFor(() => expect(actions.approveResearchProposalAction).toHaveBeenCalledTimes(2));
    const calls = vi.mocked(actions.approveResearchProposalAction).mock.calls;
    expect(calls[1]![2]).toBe(calls[0]![2]);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Approve and apply reviewed changes' })).toBeNull());
    expect(screen.getByRole('alert').textContent).toContain('Vehicle facts changed');
  });

  it('never treats worker contact as sourced success and keeps a newly minted token only in the transient credential panel', async () => {
    const local = vi.spyOn(Storage.prototype, 'setItem');
    vi.mocked(actions.mintResearchWorkerTokenAction).mockResolvedValue({ ok: true, value: { id: 'token-1', token: 'private-scoped-token-value' } });
    render(<ResearchWorkersPanel />);
    await screen.findByText('configured not tested');
    expect(screen.getByText(/Last successful sourced check: None recorded/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create scoped worker credential' }));
    const token = await screen.findByLabelText('New scoped worker token') as HTMLInputElement;
    expect(token.type).toBe('password'); expect(token.value).toBe('private-scoped-token-value');
    expect(local).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'I have stored it — hide token' }));
    expect(screen.queryByLabelText('New scoped worker token')).toBeNull();
  });
});

describe('optional monitoring', () => {
  it('creates a paused policy with bounded scope and a stable creation key on retry', async () => {
    vi.mocked(actions.saveMonitoringPolicyAction).mockResolvedValueOnce({ ok: false, code: 'connection_failed', error: 'Connection interrupted' }).mockResolvedValueOnce({ ok: true, value: { policy } });
    render(<MonitoringPanel assetId="asset-1" workers={[worker]} onResearch={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add monitoring policy' }));
    fireEvent.change(screen.getByLabelText('Policy name'), { target: { value: 'My optional review' } });
    fireEvent.change(screen.getByLabelText('Question to review'), { target: { value: 'Check only the published inspection rule' } });
    fireEvent.change(screen.getByLabelText('Allowed source domains'), { target: { value: 'example.org' } });
    fireEvent.change(screen.getByLabelText('Cadence in hours'), { target: { value: '168' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save monitoring policy' }));
    await screen.findByText('Connection interrupted');
    fireEvent.click(screen.getByRole('button', { name: 'Save monitoring policy' }));
    await waitFor(() => expect(actions.saveMonitoringPolicyAction).toHaveBeenCalledTimes(2));
    const calls = vi.mocked(actions.saveMonitoringPolicyAction).mock.calls;
    expect(calls[1]![0]).toEqual(calls[0]![0]);
    expect(calls[0]![0].enabled).toBe(false);
    expect(calls[0]![0].cadence_hours).toBe(168);
    expect(calls[0]![0].asset_ids).toEqual(['asset-1']);
    expect(calls[0]![0].creation_key).toBeTruthy();
    expect(actions.setMonitoringEnabledAction).not.toHaveBeenCalled();
  });

  it('uses the reviewed policy revision and preserves the draft on a concurrent policy conflict', async () => {
    vi.mocked(actions.loadMonitoringPoliciesAction).mockResolvedValue({ ok: true, value: { policies: [policy] } });
    vi.mocked(actions.saveMonitoringPolicyAction).mockResolvedValue({ ok: false, code: 'monitoring_conflict', error: 'The policy changed' });
    render(<MonitoringPanel assetId="asset-1" workers={[worker]} onResearch={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit policy' }));
    fireEvent.change(screen.getByLabelText('Cadence in hours'), { target: { value: '240' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save monitoring policy' }));
    await screen.findByText('The policy changed');
    expect(vi.mocked(actions.saveMonitoringPolicyAction).mock.calls[0]![1]).toEqual({ id: 'policy-1', revision: 4 });
    expect((screen.getByLabelText('Cadence in hours') as HTMLInputElement).value).toBe('240');
    expect((screen.getByRole('button', { name: 'Save monitoring policy' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Last successful check: None recorded/)).toBeTruthy();
  });

  it('queues an explicit signal with a stable key without enabling a paused policy', async () => {
    vi.mocked(actions.loadMonitoringPoliciesAction).mockResolvedValue({ ok: true, value: { policies: [policy] } });
    vi.mocked(actions.signalMonitoringAction).mockResolvedValueOnce({ ok: false, code: 'connection_failed', error: 'Connection interrupted' }).mockResolvedValueOnce({ ok: true, value: {} });
    render(<MonitoringPanel assetId="asset-1" workers={[worker]} onResearch={vi.fn()} />);
    await screen.findByText('Vehicle rules');
    fireEvent.click(screen.getByText('Request a review or report a change'));
    fireEvent.change(screen.getByLabelText('Reason for this review'), { target: { value: 'I saw the authority announce a change' } });
    fireEvent.click(screen.getByRole('button', { name: 'Queue review signal' }));
    await screen.findByText('Connection interrupted');
    fireEvent.click(screen.getByRole('button', { name: 'Queue review signal' }));
    await waitFor(() => expect(actions.signalMonitoringAction).toHaveBeenCalledTimes(2));
    const calls = vi.mocked(actions.signalMonitoringAction).mock.calls;
    expect(calls[1]![1]).toEqual(calls[0]![1]);
    expect(calls[0]![1].kind).toBe('manual_review');
    expect(actions.setMonitoringEnabledAction).not.toHaveBeenCalled();
  });
});

import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MaintenanceItem } from '@/lib/api';
import type { VehicleTrackingDraft } from '@jevi-ops/shared';
import type { KnowledgePanelData, KnowledgeTransition, ResponsibilityVersion, VehicleAssessment } from './types';
import type { SourceDescriptor } from '../sources/types';
import { AssetKnowledgePanel } from './AssetKnowledgePanel';
import { ManualKnowledgeFields, newManualKnowledgeDraft } from './ManualKnowledgeFields';

vi.mock('./actions', () => ({
  loadKnowledgePanelAction: vi.fn(), responsibilityHistoryAction: vi.fn(), saveResponsibilityAction: vi.fn(),
  previewKnowledgeAction: vi.fn(), acceptKnowledgeAction: vi.fn(), knowledgeHistoryAction: vi.fn(),
  createKnowledgeFollowupAction: vi.fn(), cancelKnowledgeTransitionAction: vi.fn(), processKnowledgeTransitionsAction: vi.fn(),
}));
import { acceptKnowledgeAction, loadKnowledgePanelAction, previewKnowledgeAction, responsibilityHistoryAction, saveResponsibilityAction } from './actions';
const loadMock = vi.mocked(loadKnowledgePanelAction);
const previewMock = vi.mocked(previewKnowledgeAction);
const acceptMock = vi.mocked(acceptKnowledgeAction);
const saveRuleMock = vi.mocked(saveResponsibilityAction);
const version: ResponsibilityVersion = { id: 'version-1', rule_id: 'rule-1', version: 1, title: 'Owner-entered renewal', kind: 'user_reminder', status: 'accepted', source_ids: [], reason: 'Entered manually', created_at: '2026-09-11T00:00:00Z', actor: 'session:owner' };
const data: KnowledgePanelData = { assessments: [], transitions: [], rules: [{ rule: { id: 'rule-1', current_version: 1 }, version }], sources: [] };
beforeEach(() => {
  loadMock.mockResolvedValue({ ok: true, value: data });
  vi.mocked(responsibilityHistoryAction).mockResolvedValue({ ok: true, value: { versions: [version] } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); });

describe('manual responsibility fields', () => {
  it('starts unknown with no tracking or invented due evidence, and keeps the explicit meter unit', () => {
    let current: VehicleTrackingDraft;
    function Harness() { const [value, setValue] = useState(newManualKnowledgeDraft); current = value; return <ManualKnowledgeFields value={value} onChange={setValue} meterUnit="mi" />; }
    render(<Harness />);
    expect((screen.getByLabelText('Applicability to this vehicle') as HTMLSelectElement).value).toBe('unknown');
    expect(screen.queryByLabelText('Actual issued expiry date (if known)')).toBeNull();
    fireEvent.click(screen.getByLabelText('Add or update operational tracking'));
    expect((screen.getByLabelText('Reminder lead time in days') as HTMLInputElement).value).toBe('0');
    expect(current!.lead_days).toBe(0);
    fireEvent.change(screen.getByLabelText('Tracking policy'), { target: { value: 'prepaid_meter' } });
    const reading = screen.getByLabelText('Purchased-to reading (mi, if known)') as HTMLInputElement;
    expect(reading.value).toBe('');
    fireEvent.change(reading, { target: { value: '54000' } });
    expect(current!.next_due_meter).toBe(54000);
    expect(current!.applicability).toBe('unknown');
  });
});

describe('asset knowledge panel', () => {
  it('previews the displayed zero-day lead without substituting the generic maintenance default', async () => {
    previewMock.mockResolvedValue({ ok: true, value: { preview: { id: 'preview-lead', fingerprint: 'd'.repeat(64), changes: [] } } });
    render(<AssetKnowledgePanel assetId="asset-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a responsibility or reminder' }));
    await screen.findByLabelText('Responsibility reference');
    fireEvent.change(screen.getByLabelText('Responsibility reference'), { target: { value: 'rule-1' } });
    fireEvent.click(screen.getByLabelText('Add or update operational tracking'));
    fireEvent.change(screen.getByLabelText('Actual issued expiry date (if known)'), { target: { value: '2027-06-01' } });
    fireEvent.change(screen.getByLabelText('Source note or rationale'), { target: { value: 'A date I entered myself' } });
    fireEvent.change(screen.getByLabelText('Reason for this decision or correction'), { target: { value: 'Track the date without advance notice' } });
    expect((screen.getByLabelText('Reminder lead time in days') as HTMLInputElement).value).toBe('0');
    fireEvent.click(screen.getByRole('button', { name: 'Preview assessment and tracking changes' }));
    await waitFor(() => expect(previewMock).toHaveBeenCalledOnce());
    const tracking = previewMock.mock.calls[0]![0].tracking;
    expect(tracking?.action).toBe('create');
    if (tracking?.action === 'create') expect(tracking.item.lead_days).toBe(0);
  });
  it('reviews before accepting and preserves the acceptance key on an interrupted retry', async () => {
    previewMock.mockResolvedValue({ ok: true, value: { preview: { id: 'preview-1', fingerprint: 'a'.repeat(64), changes: [{ kind: 'assessment', label: 'Record unknown applicability', after: { applicability: 'unknown', baseline: { secret_internal: 'hidden-value' } } }] } } });
    acceptMock.mockResolvedValueOnce({ ok: false, error: 'Connection interrupted' }).mockResolvedValueOnce({ ok: true, value: { receipt: { asset_id: 'asset-1', status: 'applied' } } });
    render(<AssetKnowledgePanel assetId="asset-1" meterUnit="km" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a responsibility or reminder' }));
    await screen.findByLabelText('Responsibility reference');
    fireEvent.change(screen.getByLabelText('Responsibility reference'), { target: { value: 'rule-1' } });
    fireEvent.change(screen.getByLabelText('Source note or rationale'), { target: { value: 'I have not established whether it applies' } });
    fireEvent.change(screen.getByLabelText('Reason for this decision or correction'), { target: { value: 'Record the current knowledge gap' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview assessment and tracking changes' }));
    await screen.findByRole('button', { name: 'Apply reviewed changes' });
    expect(acceptMock).not.toHaveBeenCalled();
    expect(saveRuleMock).not.toHaveBeenCalled();
    expect(screen.queryByText('hidden-value')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Apply reviewed changes' }));
    await screen.findByText('Connection interrupted');
    fireEvent.click(screen.getByRole('button', { name: 'Apply reviewed changes' }));
    await waitFor(() => expect(acceptMock).toHaveBeenCalledTimes(2));
    expect(acceptMock.mock.calls[1]![2]).toBe(acceptMock.mock.calls[0]![2]);
    expect(previewMock.mock.calls[0]![0].assessment.applicability).toBe('unknown');
    expect(previewMock.mock.calls[0]![0].tracking).toBeUndefined();
  });

  it('preserves existing item notes and metadata when an assessment updates tracking', async () => {
    const assessment: VehicleAssessment = { id: 'assessment-1', asset_id: 'asset-1', rule_id: 'rule-1', rule_version_id: 'version-1', revision: 1,
      applicability: 'unknown', evidence_basis: 'user_reported', review_state: 'accepted', rationale: 'Previous rationale', relevant_facts: {}, source_ids: [],
      assessed_at: '2026-09-11T00:00:00Z', last_checked_at: null, review_due_at: null, item_id: 'item-1', invalidation_reason: null, freshness: 'unchecked', knowledge_label: 'Entered by you; not independently researched' };
    loadMock.mockResolvedValue({ ok: true, value: { ...data, assessments: [assessment] } });
    previewMock.mockResolvedValue({ ok: true, value: { preview: { id: 'preview-1', fingerprint: 'b'.repeat(64), changes: [] } } });
    const item = { id: 'item-1', name: 'Existing renewal', policy: 'expiry', notes: 'Keep workshop booking details', active: true,
      interval_days: null, interval_months: null, interval_meter: null, next_due_date: '2027-01-02', next_due_meter: null, lead_days: 14, lead_meter: null,
      metadata: { annotated: 'keep' } } as unknown as MaintenanceItem;
    render(<AssetKnowledgePanel assetId="asset-1" items={[item]} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Review or update information' }));
    await screen.findByLabelText('Responsibility reference');
    fireEvent.change(screen.getByLabelText('Source note or rationale'), { target: { value: 'Updated assessment rationale' } });
    fireEvent.change(screen.getByLabelText('Reason for this decision or correction'), { target: { value: 'Clarify what I know' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview assessment and tracking changes' }));
    await waitFor(() => expect(previewMock).toHaveBeenCalledOnce());
    const tracking = previewMock.mock.calls[0]![0].tracking;
    expect(tracking?.action).toBe('update');
    if (tracking?.action === 'update') { expect(tracking.patch.notes).toBe('Keep workshop booking details'); expect(tracking.patch.metadata).toBeUndefined(); expect(tracking.patch.lead_days).toBe(14); }
    expect(previewMock.mock.calls[0]![0].assessment.rationale).toBe('Updated assessment rationale');
  });

  it('uses one creation key when retrying an immediate reference-definition save', async () => {
    saveRuleMock.mockResolvedValueOnce({ ok: false, error: 'Connection interrupted' }).mockResolvedValueOnce({ ok: true, value: { version } });
    render(<AssetKnowledgePanel assetId="asset-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a responsibility or reminder' }));
    await screen.findByLabelText('Responsibility reference');
    fireEvent.change(screen.getByLabelText('Responsibility or reminder name'), { target: { value: 'My own reminder' } });
    fireEvent.change(screen.getByLabelText('Reason for this decision or correction'), { target: { value: 'Track my own reminder' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save reference definition now' }));
    await screen.findByText('Connection interrupted');
    fireEvent.click(screen.getByRole('button', { name: 'Save reference definition now' }));
    await waitFor(() => expect(saveRuleMock).toHaveBeenCalledTimes(2));
    expect(saveRuleMock.mock.calls[1]![2]).toBe(saveRuleMock.mock.calls[0]![2]);
    expect(previewMock).not.toHaveBeenCalled();
  });

  it.each(['create', 'update', 'link'] as const)('retains a future %s tracking decision while reviewing a newer responsibility version', async (action) => {
    const revised = { ...version, id: 'version-2', version: 2, title: 'Updated renewal reference' };
    const item = { id: 'item-1', name: 'Current renewal', policy: 'expiry', notes: 'Keep existing notes', active: true, next_due_date: '2027-01-02', next_due_meter: null,
      interval_days: null, interval_months: null, interval_meter: null, lead_days: 14, lead_meter: 125 } as MaintenanceItem;
    const futureItem = { name: 'Pending renewal', policy: 'expiry', next_due_date: '2028-02-03', lead_days: 21, lead_meter: 250, notes: 'Retained proposed notes', metadata: { custom: 'Keep this' } };
    const tracking = action === 'create' ? { action, item: futureItem } : action === 'update' ? { action, item_id: item.id, patch: futureItem } : { action, item_id: item.id };
    const transition = { id: 'transition-1', asset_id: 'asset-1', status: 'needs_review', revision: 2, approved_at: '2026-09-11T00:00:00Z', applied_at: null,
      effective: { kind: 'date', date: '2027-05-01', timezone: 'Pacific/Auckland' }, effective_at: '2027-04-30T12:00:00Z', reason: 'The reference changed',
      preconditions: { rule: { id: 'rule-1', version_id: 'version-1', current_version: 1 } },
      operation: { asset_id: 'asset-1', rule_version_id: 'version-1', reason: 'Retained approval reason', tracking,
        assessment: { applicability: 'unknown', evidence_basis: 'user_reported', review_state: 'accepted', rationale: 'Retained evidence note', relevant_fact_keys: ['registration_country'], source_ids: [] } },
    } as KnowledgeTransition;
    loadMock.mockResolvedValue({ ok: true, value: { ...data, transitions: [transition], rules: [{ rule: { id: 'rule-1', current_version: 2 }, version: revised }] } });
    vi.mocked(responsibilityHistoryAction).mockResolvedValue({ ok: true, value: { versions: [revised, version] } });
    previewMock.mockResolvedValue({ ok: true, value: { preview: { id: 'preview-2', fingerprint: 'c'.repeat(64), changes: [] } } });
    render(<AssetKnowledgePanel assetId="asset-1" items={[item]} meterUnit="km" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Review against current facts' }));
    await screen.findByLabelText('Responsibility reference');
    expect((screen.getByLabelText('Responsibility reference') as HTMLSelectElement).value).toBe('rule-1');
    expect((screen.getByLabelText('Tracking action') as HTMLSelectElement).value).toBe(action);
    expect(screen.queryByRole('button', { name: 'Save reference definition now' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Preview assessment and tracking changes' }));
    await waitFor(() => expect(previewMock).toHaveBeenCalledOnce());
    const requested = previewMock.mock.calls[0]![0];
    expect(requested.rule_version_id).toBe('version-2');
    expect(requested.reason).toBe('Retained approval reason');
    expect(requested.effective).toEqual(transition.effective);
    expect(requested.tracking?.action).toBe(action);
    if (requested.tracking?.action === 'create') expect(requested.tracking.item).toMatchObject(futureItem);
    if (requested.tracking?.action === 'update') { expect(requested.tracking.item_id).toBe(item.id); expect(requested.tracking.patch).toMatchObject(futureItem); }
    if (requested.tracking?.action === 'link') expect(requested.tracking.item_id).toBe(item.id);
    expect(saveRuleMock).not.toHaveBeenCalled();
  });

  it('loads newly retained sources when opening the editor and preserves typed input during later refresh', async () => {
    render(<AssetKnowledgePanel assetId="asset-1" />);
    await screen.findByRole('button', { name: 'Add a responsibility or reminder' });
    const source: SourceDescriptor = { id: 'link-new', source_id: 'source-new', label: 'New workshop receipt', kind: 'text', media_type: 'text/plain', size_bytes: 10, content_hash: 'hash', received_at: '2026-09-11T00:00:00Z', asset_id: 'asset-1', session_id: null, processing_status: 'retained', url: null, download_url: '/api/sources/link-new/content' };
    loadMock.mockResolvedValue({ ok: true, value: { ...data, sources: [source] } });
    fireEvent.click(screen.getByRole('button', { name: 'Add a responsibility or reminder' }));
    await screen.findByLabelText('Responsibility reference');
    expect(await screen.findByLabelText('New workshop receipt')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Source note or rationale'), { target: { value: 'An unsaved assessment note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh knowledge' }));
    await waitFor(() => expect(loadMock).toHaveBeenCalledTimes(3));
    expect((screen.getByLabelText('Source note or rationale') as HTMLTextAreaElement).value).toBe('An unsaved assessment note');
  });
});

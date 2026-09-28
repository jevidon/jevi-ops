import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Workspace } from './Workspace';
import { BrowserWorkspace, type Storage } from './browser';
import { taskPatch, type Snapshot, type TaskRecord } from './model';

const task: TaskRecord = { id: 'task', title: 'Pack torch', status: 'open', priority: 4, updated_at: '2026-09-24T00:00:00Z', domain_id: 'domain', project_id: 'project' };
const snapshot: Snapshot = { identity: { task_edit_protocol: 1, dataSpaceId: 'space', serverEpoch: 1 }, domains: [{ id: 'domain', name: 'Personal' }, { id: 'empty', name: 'Empty domain' }], projects: [{ id: 'project', domain_id: 'domain', name: 'Camping' }, { id: 'empty-project', domain_id: 'domain', name: 'Empty project' }], tasks: [task], scopes: [] };
function memory(): Storage {
  let state = { snapshot: structuredClone(snapshot), edits: [] } as Awaited<ReturnType<Storage['read']>>;
  return { read: async () => structuredClone(state), update: async fn => { const next = fn(structuredClone(state)); state = structuredClone(next); return next; } };
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('shared workspace', () => {
  it('navigates empty containers offline and persists a task edit across restart', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const storage = memory();
    const adapter = new BrowserWorkspace(storage, 'test');
    const ui = render(<Workspace adapter={adapter} />);
    fireEvent.click(await screen.findByRole('button', { name: /Empty domain/ }));
    expect(screen.getByText('No projects or areas here yet.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'All domains' }));
    fireEvent.click(screen.getByRole('button', { name: /Personal/ }));
    fireEvent.click(screen.getByRole('button', { name: /Empty project/ }));
    expect(screen.getByText('No tasks here yet.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /← Personal/ }));
    fireEvent.click(screen.getByRole('button', { name: /Camping/ }));
    fireEvent.click(screen.getByRole('button', { name: /Pack torch/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Task title' }), { target: { value: 'Charge torch' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save on device' }));
    await screen.findByText('Saved on this device.');
    ui.unmount();
    const reopened = new BrowserWorkspace(storage, 'test');
    await reopened.start();
    expect(reopened.getState().edits[0]?.task.title).toBe('Charge torch');
    expect(reopened.getState().edits[0]?.body?.title).toBe('Charge torch');
    reopened.stop();
  });
  it('does not claim saved when durable storage fails, and keeps the draft', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const storage = memory();
    storage.update = async () => { throw new Error('Disk full'); };
    render(<Workspace adapter={new BrowserWorkspace(storage, 'test')} />);
    fireEvent.click(await screen.findByRole('button', { name: /Personal/ }));
    fireEvent.click(screen.getByRole('button', { name: /Camping/ }));
    fireEvent.click(screen.getByRole('button', { name: /Pack torch/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Task title' }), { target: { value: 'Keep this draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save on device' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Disk full');
    expect((screen.getByRole('textbox', { name: 'Task title' }) as HTMLInputElement).value).toBe('Keep this draft');
  });
  it('retries an ambiguous request with the same operation and preserves server conflicts', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_: string, fn: () => Promise<void>) => fn() } });
    const storage = memory();
    const attempts: RequestInit[] = [];
    const request = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      if (String(url).endsWith('identity')) return json(snapshot.identity);
      if (String(url).endsWith('snapshot')) return json({ ...snapshot, protocol_version: 1 });
      attempts.push(init!);
      if (attempts.length === 1) throw new Error('Lost connection');
      return json({ current: { ...task, title: 'Remote title' }, message: 'Both changed' }, 409);
    });
    const adapter = new BrowserWorkspace(storage, 'test', request);
    await adapter.start(); await adapter.save({ ...task, title: 'My title' });
    online.mockReturnValue(true);
    await adapter.sync();
    expect(adapter.getState().edits[0]?.attempted).toBe(true);
    await adapter.sync();
    expect(attempts[0]?.body).toEqual(attempts[1]?.body);
    expect(attempts[0]?.headers).toEqual(attempts[1]?.headers);
    expect(adapter.getState().edits[0]?.serverTask?.title).toBe('Remote title');
    expect(adapter.getState().edits[0]?.task.title).toBe('My title');
    adapter.stop();
  });
  it('rejects a stale offline tab without overwriting the newer queued edit', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const storage = memory();
    const a = new BrowserWorkspace(storage, 'same-account');
    const b = new BrowserWorkspace(storage, 'same-account');
    await a.start(); await b.start();
    await a.save({ ...task, title: 'Newer local title' });
    await expect(b.save({ ...task, due_date: '2026-10-01' })).rejects.toThrow('newer edit');
    expect((await storage.read()).edits[0]?.task.title).toBe('Newer local title');
    const edit = a.getState().edits[0]!;
    await a.save({ ...edit.task, due_date: '2026-10-01' }, edit.id);
    expect((await storage.read()).edits[0]?.body).toMatchObject({ title: 'Newer local title', due_date: '2026-10-01' });
    a.stop(); b.stop();
  });
  it('opens a pending edit from More and recovers a rejection without a server version', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const storage = memory();
    await storage.update(s => ({ ...s, edits: [{ id: 'blocked', base: task, task: { ...task, title: 'My saved version' }, attempted: true, blocked: true, error: 'Workflow changed' }] }));
    const request = vi.fn(async (url: RequestInfo | URL) => new Response(JSON.stringify(String(url).endsWith('identity') ? snapshot.identity : { ...task, title: 'Latest server title' }), { headers: { 'Content-Type': 'application/json' } }));
    render(<Workspace adapter={new BrowserWorkspace(storage, 'test', request)} />);
    await screen.findByRole('button', { name: /Personal/ });
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('button', { name: /My saved version/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Review latest server version' }));
    await screen.findByText('Latest server title');
    fireEvent.click(screen.getByRole('button', { name: 'Apply my changed fields' }));
    await screen.findByText('Conflict resolved.');
    expect((await storage.read()).edits[0]).toMatchObject({ base: { title: 'Latest server title' }, task: { title: 'My saved version' }, attempted: false });
  });
  it('offers a shared discard dialog and keeps the draft when editing continues', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    render(<Workspace adapter={new BrowserWorkspace(memory(), 'test')} />);
    fireEvent.click(await screen.findByRole('button', { name: /Personal/ }));
    fireEvent.click(screen.getByRole('button', { name: /Camping/ }));
    fireEvent.click(screen.getByRole('button', { name: /Pack torch/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Task title' }), { target: { value: 'Unsaved title' } });
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect((screen.getByRole('textbox', { name: 'Task title' }) as HTMLInputElement).value).toBe('Unsaved title');
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    expect(screen.getByRole('heading', { name: 'More' })).toBeTruthy();
  });
  it('serializes clears explicitly and records the original base', () => {
    expect(taskPatch({ ...task, notes: 'Old' }, { ...task, notes: null }, snapshot)).toMatchObject({ notes: null, _offline_base: { notes: 'Old', project_id: 'project' } });
  });
});

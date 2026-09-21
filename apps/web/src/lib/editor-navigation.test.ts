import { describe, expect, it } from 'vitest';
import { safeReturnPath, showFloatingNotifications } from './editor-navigation';

describe('editor return destinations', () => {
  it('preserves the actual origin, including filters and anchor', () => {
    expect(safeReturnPath('/projects/123?group=milestone#tasks')).toBe('/projects/123?group=milestone#tasks');
    expect(safeReturnPath('/')).toBe('/');
  });
  it.each(['https://evil.example', '//evil.example', '/\\evil.example', '/%5cevil.example', '/%2f%2fevil.example', '/sign-in', '/api/tasks', '/tasks/new', '/companies/123/edit', '/tasks/%', '/tasks/../sign-in', '/tasks\n'])('rejects unsafe or unsuitable origin %s', value => {
    expect(safeReturnPath(value)).toBeNull();
  });
  it('cannot return to the record just deleted', () => {
    expect(safeReturnPath('/tasks/123?from=x', '/tasks/123')).toBeNull();
  });
});

describe('notification placement', () => {
  it.each(['/', '/work', '/projects/123', '/domains/123', '/calendar', '/tasks', '/library/notes'])('keeps access on overview/workspace %s', path => expect(showFloatingNotifications(path)).toBe(true));
  it.each(['/tasks/123', '/tasks/new', '/projects/new', '/assets/123', '/library/notes/123', '/companies/123/edit'])('does not cover record/editor actions on %s', path => expect(showFloatingNotifications(path)).toBe(false));
});

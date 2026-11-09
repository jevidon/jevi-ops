import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot, type Root } from 'react-dom/client';
import { IconRail } from './IconRail';
import { signOutAction } from '@/app/sign-in/actions';

vi.mock('next/navigation', () => ({ usePathname: () => '/projects/project' }));
vi.mock('@/app/sign-in/actions', () => ({ signOutAction: vi.fn() }));

let root: Root | undefined;
let container: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

async function hydrateRail(mutate?: (form: HTMLFormElement) => void) {
  const view = <IconRail email="person@example.com" />;
  container = document.createElement('div');
  container.innerHTML = renderToString(view);
  document.body.append(container);
  const form = container.querySelector('form')!;
  mutate?.(form);
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const onRecoverableError = vi.fn();
  await act(async () => { root = hydrateRoot(container, view, { onRecoverableError }); });
  return { form, error, onRecoverableError };
}

describe('navigation form hydration', () => {
  it('hydrates normally without replacing the server-rendered form', async () => {
    const { form, error, onRecoverableError } = await hydrateRail();
    expect(container.querySelector('form')).toBe(form);
    expect(error).not.toHaveBeenCalled();
    expect(onRecoverableError).not.toHaveBeenCalled();
  });

  it('tolerates Chrome iOS autofill metadata and still submits the sign-out action', async () => {
    const { form, error, onRecoverableError } = await hydrateRail(form => {
      form.setAttribute('__gCrUniqueID', '1');
    });
    expect(form.getAttribute('__gcruniqueid')).toBe('1');
    expect(container.querySelector('form')).toBe(form);
    expect(error).not.toHaveBeenCalled();
    expect(onRecoverableError).not.toHaveBeenCalled();
    await act(async () => { fireEvent.submit(form); });
    expect(signOutAction).toHaveBeenCalledOnce();
  });

  it('still reports mismatches on the form’s child button', async () => {
    const { error } = await hydrateRail(form => {
      form.setAttribute('__gCrUniqueID', '1');
      form.querySelector('button')!.setAttribute('aria-label', 'Unexpected browser edit');
    });
    expect(error.mock.calls.flat().join(' ')).toContain('aria-label');
  });
});

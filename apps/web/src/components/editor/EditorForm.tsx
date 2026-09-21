'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { useEditor, type EditorResult } from './EditorShell';

function snapshot(form: HTMLFormElement): string {
  return JSON.stringify([...new FormData(form)].map(([key, value]) => [key, typeof value === 'string' ? value : [value.name, value.size, value.lastModified]]));
}

/** Each editor explicitly registers its primary form; no inferred DOM action. */
export function EditorForm({ result, deleteAction, deleteDescription, children, ...props }: Omit<ComponentProps<'form'>, 'children'> & {
  result: EditorResult | null;
  deleteAction?: () => Promise<EditorResult>;
  deleteDescription?: string;
  children: ReactNode;
}) {
  const editor = useEditor();
  const form = useRef<HTMLFormElement>(null);
  const id = useId();
  const [pending, setPending] = useState(false);
  const baseline = useRef('');
  const submitted = useRef(false);
  const lastResult = useRef(result);
  const deletion = useRef(deleteAction);
  deletion.current = deleteAction;
  const remove = useCallback(() => deletion.current!(), []);
  const dirty = useCallback(() => Boolean(form.current && snapshot(form.current) !== baseline.current), []);
  const register = editor?.register;
  const saved = editor?.saved;
  const hasDelete = Boolean(deleteAction);

  useLayoutEffect(() => {
    const element = form.current!;
    baseline.current = snapshot(element);
    // React resets action forms during commit. A native listener is needed:
    // delegated React events can be disabled while that commit is running.
    const preserveDraft = (event: Event) => event.preventDefault();
    element.addEventListener('reset', preserveDraft);
    return () => element.removeEventListener('reset', preserveDraft);
  }, []);
  useEffect(() => {
    register?.({ formId: id, dirty, pending, deleteAction: hasDelete ? remove : undefined, deleteDescription });
    return () => register?.(null);
  }, [register, id, dirty, pending, hasDelete, remove, deleteDescription]);
  useEffect(() => {
    if (result === lastResult.current) return;
    lastResult.current = result;
    submitted.current = false;
    if (result?.ok) saved?.(result);
    else if (result?.ok === false) form.current?.querySelector<HTMLElement>('[data-editor-error]')?.focus();
  }, [result, saved]);

  return <form {...props} id={id} ref={form}
    onReset={event => { event.preventDefault(); props.onReset?.(event); }}
    onSubmit={event => {
      if (submitted.current || pending) { event.preventDefault(); return; }
      props.onSubmit?.(event);
      if (!event.defaultPrevented) submitted.current = true;
    }}>
    <FormFields onPending={setPending} className={props.className} managed={Boolean(editor)}>{children}</FormFields>
    {result?.ok === false && <p role="alert" tabIndex={-1} data-editor-error className="text-sm text-accent focus:outline-none">{result.error}</p>}
  </form>;
}

function FormFields({ children, onPending, className, managed }: { children: ReactNode; onPending: (value: boolean) => void; className?: string; managed: boolean }) {
  const { pending } = useFormStatus();
  useEffect(() => onPending(pending), [pending, onPending]);
  return <fieldset disabled={pending} className={`${className ?? ''} min-w-0 border-0 p-0 m-0 ${managed ? '[&_[data-editor-local-actions]]:hidden' : ''}`}>{children}</fieldset>;
}

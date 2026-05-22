'use client';

import { useActionState } from 'react';
import { signInAction } from './actions';

const initial: { error?: string } = {};

export function SignInForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(signInAction, initial);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />

      <label className="block">
        <span className="eyebrow block mb-1">Email</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          autoFocus
          className="w-full border border-line bg-surface px-3 py-2.5 font-sans text-[15px] text-ink focus:outline-none focus:border-ink-2"
        />
      </label>

      <label className="block">
        <span className="eyebrow block mb-1">Password</span>
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
          className="w-full border border-line bg-surface px-3 py-2.5 font-sans text-[15px] text-ink focus:outline-none focus:border-ink-2"
        />
      </label>

      {state?.error && (
        <div className="font-mono text-[11px] text-accent uppercase tracking-wider">
          {state.error}
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 w-full bg-ink hover:bg-ink-2 disabled:opacity-50 disabled:cursor-not-allowed text-bg font-sans font-semibold text-[14px] uppercase tracking-wider py-3 transition-colors"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

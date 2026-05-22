import Link from 'next/link';
import { getUser } from '@/lib/auth';
import { signOutAction } from '@/app/sign-in/actions';

// Mobile-only account footer (desktop puts these in the left rail).
// Email + Settings + Sign out.

export async function AccountChip() {
  const user = await getUser();
  if (!user) return null;

  return (
    <div className="px-5 py-6 mt-6 border-t border-line flex items-center justify-between gap-3">
      <div className="font-mono text-[11px] uppercase tracking-wider text-ink-3 truncate flex-1 min-w-0">
        {user.email}
      </div>
      <Link
        href="/chat"
        className="font-mono text-[11px] uppercase tracking-wider text-ink-3 hover:text-ink-2 transition-colors"
      >
        Ask
      </Link>
      <Link
        href="/settings"
        className="font-mono text-[11px] uppercase tracking-wider text-ink-3 hover:text-ink-2 transition-colors"
      >
        Settings
      </Link>
      <form action={signOutAction}>
        <button
          type="submit"
          className="font-mono text-[11px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}

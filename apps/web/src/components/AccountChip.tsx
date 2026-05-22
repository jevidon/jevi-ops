import { getUser } from '@/lib/auth';
import { signOutAction } from '@/app/sign-in/actions';

// Minimal account footer for now — email + sign-out. Lives on Today.
// When a Settings screen exists later, move sign-out there.

export async function AccountChip() {
  const user = await getUser();
  if (!user) return null;

  return (
    <div className="px-5 py-6 mt-6 border-t border-line flex items-center justify-between">
      <div className="font-mono text-[11px] uppercase tracking-wider text-ink-3 truncate">
        {user.email}
      </div>
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

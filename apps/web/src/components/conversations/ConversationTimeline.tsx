import Link from 'next/link';
import type { Conversation } from '@/lib/api';
import { completeFollowupAction, deleteConversationAction } from './actions';

// Chronological conversation list — the heart of the CRM view. Reused on
// company / person / project detail. Presentational + a per-row delete form.
// `scope` hides the association chip that matches the current page (e.g. on a
// person page, don't repeat the person's own name on every row).

const TYPE_LABELS: Record<string, string> = {
  email: 'Email', call: 'Call', text_message: 'Text', social_dm: 'DM',
  in_person: 'In person', meeting: 'Meeting', video_call: 'Video', other: 'Other',
};

const DIRECTION_MARK: Record<string, string> = {
  inbound: '↓ in', outbound: '↑ out', internal: '· internal',
};

function fmt(iso: string, tz: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: tz, month: 'short', day: 'numeric', year: 'numeric',
  });
}

export function ConversationTimeline({
  conversations,
  tz,
  revalidatePath,
  scope,
}: {
  conversations: Conversation[];
  tz: string;
  revalidatePath: string;
  scope?: 'company' | 'person' | 'project';
}) {
  if (conversations.length === 0) {
    return (
      <p className="font-sans text-[13px] text-ink-3 italic">
        No conversations logged yet. Add one below, forward an email to your
        capture address, or say <span className="font-mono">log a call with…</span>
      </p>
    );
  }

  return (
    <ul className="flex flex-col">
      {conversations.map((c) => {
        const chips: React.ReactNode[] = [];
        if (scope !== 'company' && c.company) {
          chips.push(
            <Link key="co" href={`/companies/${c.company.id}`} className="hover:text-accent transition-colors">
              {c.company.name}
            </Link>,
          );
        }
        if (scope !== 'person' && c.person) {
          chips.push(
            <Link key="pe" href={`/people/${c.person.id}`} className="hover:text-accent transition-colors">
              {c.person.name}
            </Link>,
          );
        }
        if (scope !== 'project' && c.project) {
          chips.push(
            <Link key="pr" href={`/projects/${c.project.id}`} className="hover:text-accent transition-colors">
              {c.project.name}
            </Link>,
          );
        }
        return (
          <li key={c.id} className="py-3 border-b border-line/40 group">
            <div className="flex items-baseline justify-between gap-3">
              <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3 flex flex-wrap gap-x-2">
                <span>{fmt(c.occurred_at, tz)}</span>
                <span>· {TYPE_LABELS[c.interaction_type] ?? c.interaction_type}</span>
                <span>· {DIRECTION_MARK[c.direction] ?? c.direction}</span>
                {c.requires_followup && (
                  <span className="text-accent">
                    · follow up{c.followup_by ? ` by ${c.followup_by}` : ''}
                  </span>
                )}
                {c.requires_followup && (
                  /* One tap settles it: requires_followup → false, which
                     also clears the attention nudge server-side. */
                  <form action={completeFollowupAction} className="inline-block">
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="revalidate_path" value={revalidatePath} />
                    <button
                      type="submit"
                      className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-ink border border-line-strong rounded px-1.5 transition-colors"
                      aria-label="Mark follow-up done"
                    >
                      ✓ done
                    </button>
                  </form>
                )}
              </div>
              <form action={deleteConversationAction} className="shrink-0">
                <input type="hidden" name="id" value={c.id} />
                <input type="hidden" name="revalidate_path" value={revalidatePath} />
                <button
                  type="submit"
                  className="opacity-0 group-hover:opacity-100 font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-all"
                  aria-label="Delete conversation"
                >
                  ✕
                </button>
              </form>
            </div>
            {c.subject && (
              <div className="mt-1 font-sans text-[14px] text-ink font-medium">{c.subject}</div>
            )}
            <p className="mt-0.5 font-sans text-[14px] text-ink-2 leading-relaxed whitespace-pre-wrap">
              {c.summary}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
              {chips.map((chip, i) => (
                <span key={i}>{i > 0 && '· '}{chip}</span>
              ))}
              {c.email_deep_link && (
                <a
                  href={c.email_deep_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-ink-3 hover:text-accent transition-colors"
                >
                  {chips.length > 0 ? '· ' : ''}Open in Gmail →
                </a>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

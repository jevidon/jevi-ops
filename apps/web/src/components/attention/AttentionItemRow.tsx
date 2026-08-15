import Link from 'next/link';
import type { AttentionItem, AttentionSourceType } from '@/lib/api';
import { snoozeAttentionAction, dismissAttentionAction, actedAttentionAction } from './actions';

// One attention row — used by both the Today card and the /attention feed.
// Server component; each action is a <form> posting to a server action, so no
// client JS. The primary action ("acted on") is paired with a link to the
// source where the user actually does the thing.

// Map source → its detail page. Conversations have no standalone page, so
// they get no link (the lifecycle actions still work).
function sourceHref(type: AttentionSourceType, id: string): string | null {
  switch (type) {
    case 'person': return `/people/${id}`;
    case 'company': return `/companies/${id}`;
    case 'domain': return `/domains/${id}`;
    case 'project': return `/projects/${id}`;
    case 'task': return `/tasks/${id}`;
    case 'content': return `/content/${id}`;
    case 'conversation': return null;
    default: return null;
  }
}

const URGENCY_DOT: Record<string, string> = {
  high: 'bg-accent',
  normal: 'bg-ink-2',
  low: 'bg-ink-3',
};

export function AttentionItemRow({ item }: { item: AttentionItem }) {
  const href = sourceHref(item.source_type, item.source_id);

  return (
    <li className="py-3 border-b border-line/40 group">
      <div className="flex items-start gap-3">
        <span
          className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${URGENCY_DOT[item.urgency] ?? 'bg-ink-3'}`}
          aria-hidden
        />
        <div className="flex-1 min-w-0">
          <div className="font-sans text-[14px] text-ink leading-snug">{item.title}</div>
          {item.detail && (
            <div className="mt-0.5 font-sans text-[12px] text-ink-3 leading-snug line-clamp-2">
              {item.detail}
            </div>
          )}

          {/* Actions */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-wider">
            {href && (
              <Link href={href} className="text-ink-3 hover:text-accent transition-colors">
                {item.suggested_action ?? 'Open'} →
              </Link>
            )}
            <form action={actedAttentionAction}>
              <input type="hidden" name="id" value={item.id} />
              <button type="submit" className="text-ink-3 hover:text-ink transition-colors">
                Done
              </button>
            </form>
            <form action={snoozeAttentionAction}>
              <input type="hidden" name="id" value={item.id} />
              <button type="submit" className="text-ink-3 hover:text-ink transition-colors">
                Snooze
              </button>
            </form>
            <form action={dismissAttentionAction}>
              <input type="hidden" name="id" value={item.id} />
              <button type="submit" className="text-ink-3 hover:text-accent transition-colors">
                Dismiss
              </button>
            </form>
          </div>
        </div>
      </div>
    </li>
  );
}

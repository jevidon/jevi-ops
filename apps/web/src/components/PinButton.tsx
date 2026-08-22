import { pinsApi, type PinTargetType } from '@/lib/api';
import { pinAction, unpinAction } from '@/app/(authed)/_briefing/pin-actions';
import { Icon } from './Icon';

// Pin/unpin toggle for entity detail pages — pins the entity to the
// Briefing's Pinned panel. A server component: current state comes from one
// cheap /api/pins/lookup awaited here (no client JS, no optimistic state —
// the repo's standard form-action posture), and the actions revalidate this
// page via the hidden `path` field.

export async function PinButton({
  targetType,
  targetId,
  path,
}: {
  targetType: PinTargetType;
  targetId: string;
  // The page's own route, for revalidation after toggling.
  path: string;
}) {
  let pinned = false;
  try {
    pinned = Boolean((await pinsApi.lookup(targetType, targetId)).pin);
  } catch {
    /* render as unpinned; pinAction is idempotent either way */
  }
  return (
    <form action={pinned ? unpinAction : pinAction}>
      <input type="hidden" name="target_type" value={targetType} />
      <input type="hidden" name="target_id" value={targetId} />
      <input type="hidden" name="path" value={path} />
      <button
        type="submit"
        title={pinned ? 'Unpin from the Agenda' : 'Pin to the Agenda'}
        className={`inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] border rounded px-2.5 py-1.5 transition-colors whitespace-nowrap ${
          pinned
            ? 'border-accent-line text-accent hover:border-accent'
            : 'border-line-strong text-ink-2 hover:border-ink-3 hover:text-ink'
        }`}
      >
        <Icon name="pin" size={12} />
        {pinned ? 'Pinned' : 'Pin'}
      </button>
    </form>
  );
}

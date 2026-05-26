import Link from 'next/link';
import { ScreenHeader } from '@/components/ScreenHeader';
import { notificationsApi, ApiError, type Notification, type NotificationStatus } from '@/lib/api';
import { getAppTimezone } from '@/lib/app-settings';
import { markNotificationStatusAction, markAllReadAction } from './actions';

// /notifications — audit log of voice actions and (later) autonomous moves.
// Tabs filter by status; each row has inline mark/dismiss controls.

const TABS: { value: NotificationStatus; label: string }[] = [
  { value: 'unread', label: 'Unread' },
  { value: 'all', label: 'All' },
  { value: 'dismissed', label: 'Dismissed' },
];

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const tz = await getAppTimezone();
  const filter: NotificationStatus =
    params.status === 'all' || params.status === 'dismissed' || params.status === 'read'
      ? params.status
      : 'unread';

  let notifications: Notification[] = [];
  let errorMessage: string | null = null;

  try {
    const res = await notificationsApi.list(filter, 100);
    notifications = res.notifications;
  } catch (err) {
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  const unreadCount = notifications.filter((n) => n.status === 'unread').length;

  return (
    <div>
      <ScreenHeader
        eyebrow="Audit log"
        title="Notifications"
        meta={`${notifications.length} shown`}
      />
      <div className="hairline" />

      {/* Tabs + Mark all read */}
      <div className="px-5 lg:px-0 pt-4 flex flex-wrap items-center gap-x-3 gap-y-2 justify-between">
        <div className="flex gap-2">
          {TABS.map((tab) => (
            <Link
              key={tab.value}
              href={`/notifications${tab.value === 'unread' ? '' : `?status=${tab.value}`}`}
              className={`px-2.5 py-1 border font-mono text-[10px] uppercase tracking-wider transition-colors ${
                filter === tab.value
                  ? 'bg-ink text-bg border-ink'
                  : 'border-line text-ink-2 hover:border-ink-2 hover:text-ink'
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </div>
        {unreadCount > 0 && (
          <form action={markAllReadAction}>
            <button
              type="submit"
              className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-ink-2 transition-colors"
            >
              Mark all read
            </button>
          </form>
        )}
      </div>

      {errorMessage ? (
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3">
          Couldn't load: {errorMessage}
        </div>
      ) : notifications.length === 0 ? (
        <div className="px-5 lg:px-0 mt-8 font-sans text-[13px] text-ink-3 italic">
          Nothing here. {filter === 'unread' && 'All caught up.'}
        </div>
      ) : (
        <ul className="px-5 lg:px-0 mt-4">
          {notifications.map((n) => (
            <NotificationRow key={n.id} notification={n} tz={tz} />
          ))}
        </ul>
      )}
    </div>
  );
}

function NotificationRow({ notification, tz }: { notification: Notification; tz: string }) {
  const isUnread = notification.status === 'unread';
  const isDismissed = notification.status === 'dismissed';
  const isFailed = notification.type.endsWith('_failed');
  const isSkipped = notification.type.endsWith('_skipped');

  const when = new Date(notification.created_at).toLocaleString('en-US', {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <li
      className={`py-3 border-b border-line/40 last:border-b-0 ${
        isUnread ? '' : 'opacity-60'
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${
            isFailed ? 'bg-accent' : isSkipped ? 'bg-ink-3' : isUnread ? 'bg-ink' : 'bg-transparent border border-line'
          }`}
          aria-hidden
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <div className="font-sans text-[14px] text-ink leading-snug">
              {notification.source_url ? (
                <Link href={notification.source_url} className="hover:text-accent transition-colors">
                  {notification.title}
                </Link>
              ) : (
                notification.title
              )}
            </div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3 shrink-0">
              {when}
            </div>
          </div>
          {notification.body && (
            <div className="mt-0.5 font-sans text-[12px] text-ink-2 leading-snug">
              {notification.body}
            </div>
          )}
          <div className="mt-1 flex items-center gap-3">
            {isUnread && (
              <form action={markNotificationStatusAction}>
                <input type="hidden" name="id" value={notification.id} />
                <input type="hidden" name="status" value="read" />
                <button className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-ink-2 transition-colors">
                  Mark read
                </button>
              </form>
            )}
            {!isDismissed && (
              <form action={markNotificationStatusAction}>
                <input type="hidden" name="id" value={notification.id} />
                <input type="hidden" name="status" value="dismissed" />
                <button className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors">
                  Dismiss
                </button>
              </form>
            )}
            {isDismissed && (
              <form action={markNotificationStatusAction}>
                <input type="hidden" name="id" value={notification.id} />
                <input type="hidden" name="status" value="unread" />
                <button className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-ink-2 transition-colors">
                  Restore
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

import { env } from './env.js';

// Thin Pushover HTTP client. Pushover's API is a single POST to
// https://api.pushover.net/1/messages.json with form-encoded body.
// Docs: https://pushover.net/api

export interface PushoverMessage {
  title: string;
  message: string;
  // Optional click-through URL — shown as a "view" link in the notification.
  url?: string;
  url_title?: string;
  // -2 silent, -1 quiet, 0 normal (default), 1 high (bypasses Do Not Disturb),
  // 2 emergency (requires acknowledgement). Task reminders default to 0.
  priority?: -2 | -1 | 0 | 1 | 2;
}

export function isPushoverConfigured(): boolean {
  return Boolean(env.PUSHOVER_USER_KEY && env.PUSHOVER_API_TOKEN);
}

export async function sendPushover(msg: PushoverMessage): Promise<{
  ok: boolean;
  status: number;
  body: string;
}> {
  if (!isPushoverConfigured()) {
    return { ok: false, status: 0, body: 'pushover_not_configured' };
  }

  const body = new URLSearchParams({
    token: env.PUSHOVER_API_TOKEN!,
    user: env.PUSHOVER_USER_KEY!,
    title: msg.title,
    message: msg.message,
    priority: String(msg.priority ?? 0),
  });
  if (msg.url) body.set('url', msg.url);
  if (msg.url_title) body.set('url_title', msg.url_title);

  const res = await fetch('https://api.pushover.net/1/messages.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text };
}

import { redirect } from 'next/navigation';

// The Briefing moved to the app root (`/`) — the home page shouldn't need a
// path segment. This stub keeps old bookmarks and installed-PWA start URLs
// working. The briefing's client modules (brief-line, actions) still live in
// this folder and are imported by (authed)/page.tsx.
export default function TodayRedirect() {
  redirect('/');
}

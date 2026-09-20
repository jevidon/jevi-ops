// Which domain cards are open on the Work page, remembered across visits.
//
// A cookie rather than sessionStorage so the SERVER can render the right
// cards open on the first paint: a client-side restore after hydration pops
// rows open under the user and defeats the browser's back-navigation scroll
// restore (the page is a different height by the time it scrolls). The page
// component reads it, filters to ids the payload still knows, and passes the
// result down as `initialExpanded`; the view writes it back on every toggle.
// No directive on this module: both the server page and the client view
// import it.

export const WORK_OPEN_COOKIE = 'jops2.work_open';
const ONE_YEAR_S = 365 * 24 * 60 * 60;

export function parseOpenCookie(value: string | undefined | null): string[] {
  if (!value) return [];
  try {
    return decodeURIComponent(value).split(',').filter(Boolean);
  } catch {
    // A mangled cookie means a collapsed board, never a broken one.
    return [];
  }
}

export function openCookieString(ids: Iterable<string>): string {
  return `${WORK_OPEN_COOKIE}=${encodeURIComponent([...ids].join(','))};path=/;max-age=${ONE_YEAR_S};SameSite=Lax`;
}

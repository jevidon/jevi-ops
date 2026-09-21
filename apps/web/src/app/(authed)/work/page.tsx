import { workApi, focusApi, domainsApi } from '@/lib/api';
import { getAppTimezone } from '@/lib/app-settings';
import { tomorrowIsoDate } from '@/lib/today';
import { WorkView } from './work-view';

// /work — the computed manager's map (Addendum 08). Replaces the Projects and
// Domains index pages: one page answering "where does everything stand?".
// Everything is computed server-side; the view only filters/collapses.
//
// It also carries Tomorrow's Focus (Addendum 09) — the evening pick, reduced to
// one quiet line at the top. Read here rather than inside the client view so
// the app-timezone date math stays server-side.

export const dynamic = 'force-dynamic';

export default async function WorkPage() {
  const tz = await getAppTimezone();
  // Resolve the target day ONCE and thread it through to the control, so the
  // day being read is the same day a later click writes (see work/actions.ts).
  const tomorrowDate = tomorrowIsoDate(tz);
  const [payload, focusRes, domainsRes] = await Promise.all([
    workApi.get(),
    // Unset is normal, and a focus failure must never take the map down.
    focusApi.get(tomorrowDate).catch(() => ({ focus: null })),
    // Committed engravings become section art in the domain headers.
    // Fork feature; a failure just means headers render without art.
    domainsApi.list().catch(() => ({ domains: [] })),
  ]);

  // Only committed art rides along — the procedural fallback on every header
  // would read as clutter, not identity.
  const art: Record<string, string> = {};
  for (const d of domainsRes.domains) {
    if (d.illustration?.svg) art[d.id] = d.illustration.svg;
  }

  const f = focusRes.focus;
  const tomorrowFocus = f
    ? {
        title: f.title,
        href: f.target_type === 'project' ? `/projects/${f.target_id}` : `/content/${f.target_id}`,
      }
    : null;

  return (
    <WorkView payload={payload} tomorrowFocus={tomorrowFocus} tomorrowDate={tomorrowDate} art={art} />
  );
}

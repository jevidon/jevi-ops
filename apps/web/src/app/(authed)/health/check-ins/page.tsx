import { ScreenHeader } from '@/components/ScreenHeader';
import { healthApi, ApiError, type WellbeingCheckIn } from '@/lib/api';
import { getAppTimezone } from '@/lib/app-settings';
import { HealthTabBar } from '../health-tab-bar';
import { CheckInForm } from './check-in-form';
import { deleteCheckInAction } from './actions';

export default async function CheckInsPage() {
  const tz = await getAppTimezone();
  let checkIns: WellbeingCheckIn[] = [];
  let errorMessage: string | null = null;
  try {
    const res = await healthApi.checkIns.list({ limit: 200 });
    checkIns = res.check_ins;
  } catch (err) {
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  return (
    <div>
      <ScreenHeader eyebrow="Personal record" title="Check-ins" meta={`${checkIns.length} logged`} />
      <div className="hairline" />
      <HealthTabBar />

      <div className="px-5 lg:px-0">
        <p className="mt-4 max-w-2xl font-sans text-[13px] text-ink-2 leading-relaxed">
          Quick subjective ratings + an optional note. Skip any rating that doesn&rsquo;t
          apply — the form accepts partial entries. These feed the trend views and
          the future health-summary feature.
        </p>

        <CheckInForm />

        <div className="mt-8 eyebrow pb-2 border-b border-line">Recent</div>
        {errorMessage ? (
          <div className="mt-4 font-sans text-[13px] text-accent">{errorMessage}</div>
        ) : checkIns.length === 0 ? (
          <div className="mt-4 font-sans text-[13px] text-ink-3 italic">
            No check-ins yet.
          </div>
        ) : (
          <ul className="mt-2 divide-y divide-line/40">
            {checkIns.map((c) => (
              <CheckInRow key={c.id} c={c} tz={tz} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CheckInRow({ c, tz }: { c: WellbeingCheckIn; tz: string }) {
  const when = new Date(c.checked_in_at).toLocaleString('en-US', {
    timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  return (
    <li className="py-3 flex items-start justify-between gap-4 group">
      <div className="flex-1 min-w-0">
        <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3 mb-1">{when}</div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] uppercase tracking-wider text-ink-2">
          {c.mood != null && <span>Mood {c.mood}/5</span>}
          {c.energy != null && <span>Energy {c.energy}/5</span>}
          {c.sleep_quality != null && <span>Sleep {c.sleep_quality}/5</span>}
          {c.pain != null && <span>Pain {c.pain}/10</span>}
        </div>
        {c.notes && (
          <p className="mt-1 font-sans text-[13px] text-ink-2 leading-snug whitespace-pre-wrap">
            {c.notes}
          </p>
        )}
      </div>
      <form action={deleteCheckInAction} className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <input type="hidden" name="id" value={c.id} />
        <button
          type="submit"
          aria-label="Delete check-in"
          className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
        >
          ✕
        </button>
      </form>
    </li>
  );
}

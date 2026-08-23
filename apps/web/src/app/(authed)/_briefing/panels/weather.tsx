import { getFrameData } from '@/lib/frame-data';
import { PanelFrame } from '../PanelFrame';
import { TempCurve } from './temp-curve';
import type { BriefingContext } from '../registry';

// Weather — the InkyPi data bundle rendered natively (Agenda layout v2
// follow-up). Same information as the Frame image's weather section, but
// in the app's own type, tokens, and themes: current conditions with the
// data-point strip, a 24h temperature curve, and the day forecast. The
// bundle is another system's internals, so every field renders defensively
// and the panel degrades to a quiet notice when the device is unreachable.

export async function WeatherPanel({ ctx }: { ctx: BriefingContext }) {
  const url = ctx.agendaDataUrl;
  if (!url) return null;

  const bundle = await getFrameData(url);
  const d = bundle?.data;
  if (!d) {
    return (
      <section className="px-5 lg:px-0">
        <PanelFrame eyebrow="Weather">
          <p className="font-mono text-[10px] uppercase tracking-wider text-ink-3 py-1">
            Weather data unreachable — is the frame online?
          </p>
        </PanelFrame>
      </section>
    );
  }

  const unit = d.temperature_unit ?? '°';
  const forecast = (d.forecast ?? []).slice(0, 5);
  const hours = d.hourly_forecast ?? [];

  return (
    <PanelFrame
      eyebrow={<>Weather{d.title ? ` · ${d.title}` : ''}</>}
      action={
        d.updated_at_text ? (
          <span className="font-mono text-[10px] uppercase tracking-wider text-ink-4">
            {d.updated_at_text}
          </span>
        ) : undefined
      }
    >
      {/* Current conditions + data points */}
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
        {d.current_temperature != null && (
          <div className="flex items-baseline gap-2">
            <span className="font-serif text-[44px] font-medium leading-none text-ink tracking-[-0.02em]">
              {d.current_temperature}
              <span className="text-[22px] text-ink-2 ml-0.5">{unit}</span>
            </span>
            {d.current_temperature_alt != null && d.temperature_unit_alt && (
              <span className="font-mono text-[11px] text-ink-3">
                {d.current_temperature_alt}
                {d.temperature_unit_alt}
              </span>
            )}
          </div>
        )}
        {(d.data_points ?? []).length > 0 && (
          <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {(d.data_points ?? []).map((dp) => (
              <div key={dp.label} className="flex items-baseline gap-1.5">
                <dt className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-4">
                  {dp.label}
                </dt>
                <dd className="font-sans text-[13px] text-ink-2 tabular-nums">
                  {dp.arrow ? `${dp.arrow} ` : ''}
                  {dp.measurement}
                  {dp.unit ? <span className="text-ink-3 text-[11px]"> {dp.unit}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {/* 24h temperature curve */}
      {hours.length >= 2 && (
        <div className="mt-3">
          <TempCurve hours={hours} unit={unit} />
        </div>
      )}

      {/* Day forecast strip */}
      {forecast.length > 0 && (
        <div className="mt-3 grid grid-cols-5 gap-2 border-t border-line pt-3">
          {forecast.map((f) => (
            <div key={f.date ?? f.day} className="flex flex-col items-center gap-0.5">
              <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-3">
                {f.day}
              </span>
              <span className="font-sans text-[13px] text-ink tabular-nums">
                {f.high}°<span className="text-ink-4 mx-0.5">/</span>
                <span className="text-ink-3">{f.low}°</span>
              </span>
              {f.rain_pct != null && f.rain_pct > 0 && (
                <span className="font-mono text-[9px] text-prio3 tabular-nums">{f.rain_pct}%</span>
              )}
            </div>
          ))}
        </div>
      )}
    </PanelFrame>
  );
}

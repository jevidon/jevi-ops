'use client';

import { useRef, useState } from 'react';
import type { WeatherHour } from '@/lib/frame-data';

// 24h temperature curve for the Weather panel. Single series → one axis,
// no legend (the panel header names it); 2px accent line over a faint
// area, recessive grid, selective direct labels (max + min only), and a
// crosshair tooltip on hover. Colors ride the app tokens so both themes
// validate against their own surface.

const W = 600;
const H = 120;
const PAD_X = 6;
const PAD_TOP = 18;
const PAD_BOTTOM = 20;

export function TempCurve({ hours, unit }: { hours: WeatherHour[]; unit: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  if (hours.length < 2) return null;

  const temps = hours.map((h) => h.temperature);
  const min = Math.min(...temps);
  const max = Math.max(...temps);
  const span = Math.max(max - min, 1);
  const minIdx = temps.indexOf(min);
  const maxIdx = temps.indexOf(max);

  const x = (i: number) => PAD_X + (i / (hours.length - 1)) * (W - PAD_X * 2);
  const y = (t: number) =>
    PAD_TOP + (1 - (t - min) / span) * (H - PAD_TOP - PAD_BOTTOM);

  const linePath = temps.map((t, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(t).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${x(hours.length - 1).toFixed(1)},${H - PAD_BOTTOM} L${x(0).toFixed(1)},${H - PAD_BOTTOM} Z`;

  function onMove(e: React.PointerEvent) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const frac = (e.clientX - rect.left) / rect.width;
    const i = Math.round(frac * (hours.length - 1));
    setHover(Math.max(0, Math.min(hours.length - 1, i)));
  }

  const hovered = hover != null ? hours[hover] : null;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full h-auto touch-none"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`Temperature over the next ${hours.length} hours, from ${min} to ${max}${unit}`}
      >
        {/* recessive grid: min/max gridlines only */}
        <line x1={PAD_X} x2={W - PAD_X} y1={y(max)} y2={y(max)} className="stroke-line" strokeWidth="1" />
        <line x1={PAD_X} x2={W - PAD_X} y1={y(min)} y2={y(min)} className="stroke-line" strokeWidth="1" />

        <path d={areaPath} className="fill-accent/10" />
        <path d={linePath} className="stroke-accent" strokeWidth="2" fill="none" strokeLinejoin="round" strokeLinecap="round" />

        {/* selective direct labels: the extremes, in text tokens */}
        <text x={x(maxIdx)} y={y(max) - 6} textAnchor="middle" className="fill-ink-2 font-mono" fontSize="11" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {max}{unit}
        </text>
        <text x={x(minIdx)} y={y(min) + 14} textAnchor="middle" className="fill-ink-3 font-mono" fontSize="11" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {min}{unit}
        </text>

        {/* time ticks: first / middle / last */}
        {[0, Math.floor((hours.length - 1) / 2), hours.length - 1].map((i) => (
          <text
            key={i}
            x={x(i)}
            y={H - 6}
            textAnchor={i === 0 ? 'start' : i === hours.length - 1 ? 'end' : 'middle'}
            className="fill-ink-4 font-mono"
            fontSize="10"
          >
            {hours[i]?.time}
          </text>
        ))}

        {/* crosshair + marker */}
        {hover != null && hovered && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD_TOP - 6} y2={H - PAD_BOTTOM} className="stroke-line-strong" strokeWidth="1" />
            <circle cx={x(hover)} cy={y(hovered.temperature)} r="4" className="fill-accent stroke-bg" strokeWidth="2" />
          </g>
        )}
      </svg>

      {hover != null && hovered && (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 bg-surface border border-line-strong rounded px-2 py-1 font-mono text-[10px] text-ink whitespace-nowrap shadow-sm"
          style={{ left: `${(x(hover) / W) * 100}%` }}
        >
          {hovered.time} · <span style={{ fontVariantNumeric: 'tabular-nums' }}>{hovered.temperature}{unit}</span>
          {hovered.precipitation != null && hovered.precipitation > 0 && (
            <span className="text-ink-3"> · {Math.round(hovered.precipitation * 100)}%</span>
          )}
        </div>
      )}
    </div>
  );
}

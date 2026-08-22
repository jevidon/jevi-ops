// The Almanac mark, v2 ("Record Rose W", mark study Aug 2026): a dominant
// record-button disc (r 8.2) wearing a compass rose — split-kite needles at
// the four cardinal headings (tails at 9.4, apexes at 15, hollow halves cut
// as true insets with a uniform 0.45 border) and small solid ticks at the
// intercardinals. Pure fills, no strokes, so every edge stays sharp at any
// raster size. Replaces the v1 eight-point star.
//
// Brand identity, not a theme surface: rendered in pinned linen (#F6F2EA)
// on the accent tile in both themes — same rule the v1 star followed.
// KEEP IN SYNC with app/icon.svg (the favicon carries the same geometry as
// a raw SVG file).
//
// `coreClassName` styles the center disc — the BottomTabBar passes the
// recording pulse class while the Capture Portal is listening.

const NEEDLE_SOLID = '16,1.0 17.9,4.6 16,6.6';
const NEEDLE_HOLLOW = 'M16,1.0 L14.1,4.6 L16,6.6Z M15.55,2.82 L14.65,4.52 L15.55,5.47Z';
const TICK = '16,3.4 14.9,6.0 17.1,6.0';

function Needle({ rotate }: { rotate?: number }) {
  return (
    <g transform={rotate ? `rotate(${rotate} 16 16)` : undefined}>
      <polygon points={NEEDLE_SOLID} />
      <path fillRule="evenodd" d={NEEDLE_HOLLOW} />
    </g>
  );
}

export function AlmanacMark({
  className,
  coreClassName,
}: {
  className?: string;
  coreClassName?: string;
}) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="#F6F2EA" aria-hidden>
      <circle cx="16" cy="16" r="8.2" className={coreClassName} />
      <Needle />
      <Needle rotate={90} />
      <Needle rotate={180} />
      <Needle rotate={270} />
      <polygon points={TICK} transform="rotate(45 16 16)" />
      <polygon points={TICK} transform="rotate(135 16 16)" />
      <polygon points={TICK} transform="rotate(225 16 16)" />
      <polygon points={TICK} transform="rotate(315 16 16)" />
    </svg>
  );
}

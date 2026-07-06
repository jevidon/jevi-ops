// GitHub-contributions-style heatmap for routine completions.
//
// Takes a flat oldest-first array of day cells (the shape that
// recentDaysGrid returns from @jevi-ops/shared) and arranges them
// into week columns × weekday rows. The first cell aligns to its
// own weekday — empty cells pad the top of the first column.
//
// Sun is the top row, Sat is the bottom. We use UTC weekday math
// against the date string (anchored at noon UTC) so DST shifts
// can't push a day into the wrong row.

interface Cell {
  date: string;       // YYYY-MM-DD
  done: boolean;
  isToday: boolean;
}

type Size = 'sm' | 'md' | 'lg';
type Layout = 'weeks' | 'row';

const SIZE_CLASSES: Record<Size, { cell: string; gap: string }> = {
  sm: { cell: 'h-2 w-2', gap: 'gap-[2px]' },
  md: { cell: 'h-3 w-3', gap: 'gap-1' },
  lg: { cell: 'h-4 w-4', gap: 'gap-1' },
};

export function RoutineHeatmap({
  cells,
  size = 'lg',
  layout = 'weeks',
  ariaLabel,
}: {
  cells: readonly Cell[];
  size?: Size;
  layout?: Layout;
  ariaLabel?: string;
}) {
  if (cells.length === 0) return null;

  const { cell: cellClass, gap: gapClass } = SIZE_CLASSES[size];

  if (layout === 'row') {
    // Single horizontal strip — useful inline next to a routine name.
    // Cells flow left→right, oldest on the left, today on the right.
    return (
      <div
        role="img"
        aria-label={ariaLabel ?? 'Routine completion strip'}
        className={`inline-flex items-center ${gapClass}`}
      >
        {cells.map((c) => (
          <div
            key={c.date}
            title={`${c.date}${c.isToday ? ' (today)' : ''} — ${c.done ? 'done' : 'missed'}`}
            className={`${cellClass} border ${
              c.done ? 'bg-ink border-ink' : 'border-line bg-transparent'
            } ${c.isToday ? 'ring-1 ring-accent ring-offset-1 ring-offset-bg' : ''}`}
          />
        ))}
      </div>
    );
  }

  // Week-column grid — GitHub-contributions style.
  const firstCell = cells[0]!;
  const firstDate = new Date(`${firstCell.date}T12:00:00Z`);
  // 0 = Sunday, 6 = Saturday.
  const firstDow = firstDate.getUTCDay();

  // Pad the start so the first real cell lands at row = firstDow.
  // We render column-by-column (grid-flow: column), so these padding
  // cells fill rows 0..firstDow-1 of the first column.
  const paddedCount = firstDow;

  return (
    <div
      role="img"
      aria-label={ariaLabel ?? 'Routine completion heatmap'}
      className={`inline-grid grid-flow-col ${gapClass}`}
      style={{ gridTemplateRows: 'repeat(7, min-content)' }}
    >
      {Array.from({ length: paddedCount }, (_, i) => (
        <div key={`pad-${i}`} className={`${cellClass} opacity-0`} aria-hidden />
      ))}
      {cells.map((c) => (
        <div
          key={c.date}
          title={`${c.date}${c.isToday ? ' (today)' : ''} — ${c.done ? 'done' : 'missed'}`}
          className={`${cellClass} border ${
            c.done ? 'bg-ink border-ink' : 'border-line bg-transparent'
          } ${c.isToday ? 'ring-1 ring-accent ring-offset-1 ring-offset-bg' : ''}`}
        />
      ))}
    </div>
  );
}

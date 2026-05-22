'use client';

import { useTransition } from 'react';
import { PROJECT_COLOR_PALETTE } from '@jerad-ops/shared';
import { setProjectColorAction } from './actions';

export function ProjectColorPicker({
  projectId,
  current,
}: {
  projectId: string;
  current: string | null;
}) {
  const [pending, startTransition] = useTransition();

  const pick = (color: string) => {
    const form = new FormData();
    form.set('projectId', projectId);
    form.set('color', color);
    startTransition(async () => {
      await setProjectColorAction(form);
    });
  };

  return (
    <div className={`flex items-center gap-2 ${pending ? 'opacity-50' : ''}`}>
      <span className="eyebrow shrink-0">Color</span>
      <div className="flex items-center gap-1.5">
        {PROJECT_COLOR_PALETTE.map((color) => {
          const selected = current === color;
          return (
            <button
              key={color}
              type="button"
              onClick={() => pick(color)}
              aria-label={`Set color ${color}`}
              aria-pressed={selected}
              className={`h-4 w-4 rounded-full transition-transform ${
                selected ? 'ring-2 ring-offset-2 ring-offset-bg ring-ink scale-110' : 'hover:scale-110'
              }`}
              style={{ backgroundColor: color }}
            />
          );
        })}
        <button
          type="button"
          onClick={() => pick('')}
          aria-label="Clear color"
          aria-pressed={!current}
          className={`h-4 w-4 rounded-full border border-line transition-transform bg-bg ${
            !current ? 'ring-2 ring-offset-2 ring-offset-bg ring-ink scale-110' : 'hover:scale-110'
          }`}
          title="No color"
        />
      </div>
    </div>
  );
}

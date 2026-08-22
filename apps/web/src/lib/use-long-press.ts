'use client';

import { useCallback, useRef } from 'react';
import type React from 'react';

// Dependency-free long-press detection for the Capture Portal star. Pointer
// events only — deliberately NO click handler on the consuming element, so
// tap is delivered exactly once via pointerup (no iOS ghost-click double
// fire). The consumer should also set `select-none`,
// `touchAction: 'manipulation'`, and `WebkitTouchCallout/UserSelect: 'none'`
// so the browser's own long-press UI (magnifier, callout, context menu)
// stays out of the way. Per the IconRail gotcha, keep the target free of
// hover-dependent behavior — an emulated mouseenter on iOS that mutates
// layout makes Safari swallow the subsequent tap.

export function useLongPress(opts: {
  onTap: () => void;
  onLongPress: () => void;
  delayMs?: number;
  moveThreshold?: number; // px of drift before the press is treated as a scroll
}): {
  onPointerDown: React.PointerEventHandler;
  onPointerMove: React.PointerEventHandler;
  onPointerUp: React.PointerEventHandler;
  onPointerCancel: React.PointerEventHandler;
  onContextMenu: React.MouseEventHandler;
} {
  const { onTap, onLongPress, delayMs = 500, moveThreshold = 10 } = opts;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const firedRef = useRef(false); // long-press already delivered
  const cancelledRef = useRef(false); // drifted past threshold → neither fires

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onPointerDown: React.PointerEventHandler = useCallback(
    (e) => {
      if (!e.isPrimary) return;
      originRef.current = { x: e.clientX, y: e.clientY };
      firedRef.current = false;
      cancelledRef.current = false;
      clearTimer();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        firedRef.current = true;
        // Recording starts while the finger is still down; a tiny haptic
        // tick marks the moment on devices that support it.
        try { navigator.vibrate?.(10); } catch { /* noop */ }
        onLongPress();
      }, delayMs);
    },
    [clearTimer, delayMs, onLongPress],
  );

  const onPointerMove: React.PointerEventHandler = useCallback(
    (e) => {
      const origin = originRef.current;
      if (!origin || cancelledRef.current || firedRef.current) return;
      const dx = e.clientX - origin.x;
      const dy = e.clientY - origin.y;
      if (Math.hypot(dx, dy) > moveThreshold) {
        // Press became a scroll/drag — abandon both gestures.
        cancelledRef.current = true;
        clearTimer();
      }
    },
    [clearTimer, moveThreshold],
  );

  const onPointerUp: React.PointerEventHandler = useCallback(
    (e) => {
      if (!e.isPrimary) return;
      clearTimer();
      const wasCancelled = cancelledRef.current;
      const wasLong = firedRef.current;
      originRef.current = null;
      cancelledRef.current = false;
      // Long-press already delivered on the timer; release does nothing
      // (recording persists after the finger lifts).
      if (!wasLong && !wasCancelled) onTap();
    },
    [clearTimer, onTap],
  );

  const onPointerCancel: React.PointerEventHandler = useCallback(() => {
    clearTimer();
    originRef.current = null;
    cancelledRef.current = false;
    firedRef.current = false;
  }, [clearTimer]);

  const onContextMenu: React.MouseEventHandler = useCallback((e) => {
    // Kills the browser/OS long-press context menu on the target.
    e.preventDefault();
  }, []);

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onContextMenu };
}

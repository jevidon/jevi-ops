'use server';

import { revalidatePath } from 'next/cache';
import { contentApi, focusApi, type FocusTargetType } from '@/lib/api';

// Flip a content item's holder (Addendum 08 §2 — unconstrained, one tap). The
// API stamps holder_since. Best-effort; the Work page revalidates so the aging
// count resets immediately.
export async function flipHolderAction(id: string, next: 'me' | 'editor'): Promise<void> {
  try {
    await contentApi.update(id, { holder: next });
  } catch {
    /* best-effort */
  }
  revalidatePath('/work');
}

// Tomorrow's Focus (Addendum 09). One tap to set, one to clear — never a flow.
//
// `date` is threaded through from the server render (work/page.tsx computes it
// with the app timezone) rather than letting the API re-resolve "tomorrow" at
// request time. Those differ across an app-local midnight: a page rendered at
// 23:58 shows tomorrow = the 24th, but a click at 00:01 would have the API
// resolve the 25th — clearing a row that doesn't exist while the real focus
// silently became *today's*. Evening is exactly when this control gets used, so
// the window is not hypothetical. These are server actions, so the browser's
// timezone is never involved either way.
export async function setFocusAction(
  targetType: FocusTargetType,
  targetId: string,
  date: string,
): Promise<void> {
  try {
    await focusApi.set({ date, target_type: targetType, target_id: targetId });
  } catch {
    /* best-effort; revalidate resyncs */
  }
  revalidatePath('/work');
  revalidatePath('/today');
}

export async function clearFocusAction(date: string): Promise<void> {
  try {
    await focusApi.clear(date);
  } catch {
    /* best-effort */
  }
  revalidatePath('/work');
  revalidatePath('/today');
}

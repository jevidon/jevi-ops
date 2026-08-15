// The Pivot Protocol (the-daily-rule.md §The Pivot Protocol). Shown after a
// hedge is logged. Pre-decided and physical — the point is to act, not read.
//
// This lives in a config module so the pivots can be edited without touching
// flow logic. (If you later want to edit them without a deploy, we can move
// this into app_settings and expose it on the settings page.)

export interface Pivot {
  trigger: string;
  response: string;
}

export const PIVOT_PROTOCOL: {
  intro: string;
  pivots: Pivot[];
} = {
  intro: 'Pre-decided and physical. Fleeing means my body leaves the room (2 Tim. 2:22).',
  pivots: [
    {
      trigger: 'Caught scrolling',
      response:
        'Phone in the drawer, leave the room, 20 pushups or 5 minutes outside, then open the keystone doc.',
    },
    {
      trigger: 'Tinkering on something new',
      response:
        'Write "I\'m hedging on ___" in the log, then 10 minutes on the real task. The entry is the pivot.',
    },
    {
      trigger: 'Bedtime, mid-anything',
      response: 'It stops mid-sentence. The bedtime is the commitment; the task isn\'t.',
    },
    {
      trigger: 'Avoiding Scripture',
      response: 'Slow down, don\'t skip. Capture, interrogate, replace.',
    },
  ],
};

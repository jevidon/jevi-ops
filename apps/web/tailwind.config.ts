import type { Config } from 'tailwindcss';

// Design tokens — v2 "high-contrast editorial" (design handoff, Jul 2026).
//   serif:  Newsreader
//   sans:   Geist
//   mono:   Geist Mono
//   accent: #B8442B (rust) — UNCHANGED from v1; the brand red stays.
//   canvas: #F6F2EA (linen) — re-warmed (Addendum 10 §4). The v2 build first
//     went white #FFF; that read too cold/whitespace-heavy, so the canvas
//     returns to warm linen. Raised surfaces (rails, lifted cards) go to a
//     paper tone LIGHTER than linen so they still read as surfaces; recessed
//     fills stay darker. Ink ramp / accent / status colours are unchanged —
//     dark ink + warm accent on a warm ground is the original v1 reading.
//
// Status is the one place the palette leaves monochrome: four states
// (overdue/due-today/on-track/quiet), each a colour + soft fill + border,
// used only inside pills. Priority rings and domain identity colours are
// separate axes again (priority lives here; domain colours are a client map).
//
// Token names are kept stable across the v1→v2 value swap so the ~1600
// existing bg-/text-ink/border-line usages re-theme without renames.

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Desktop gate: 800px (down from Tailwind's default lg=1024). `lg:` IS the
      // app's mobile↔desktop shell split (IconRail vs BottomTabBar, facet rail
      // vs pill, main max-width), so moving this one token moves the whole gate.
      // Set ~20px below the measured foldable INNER-portrait width (821) so the
      // inner screen renders desktop in BOTH orientations (821 / 1088) while the
      // cover stays mobile (portrait 555). Merges with defaults, so only lg
      // changes and the sequence stays ascending (640/768/800/1280/1536).
      // Known edge: cover-landscape (830) sits just above the gate and renders
      // desktop — unavoidable with a single width breakpoint (830 > inner 821),
      // and a folded phone held sideways is a non-scenario.
      screens: {
        lg: '800px',
      },
      colors: {
        // ─── Surfaces (re-warmed to linen, Addendum 10 §4) ────────────
        bg: '#F6F2EA',           // canvas — warm linen (was #FFFFFF)
        surface: '#FCFAF5',      // rail + lifted-card paper, lighter than linen (--paper-2)
        'surface-2': '#EFE9DD',  // recessed fills: meters, empty cells, hover chips (darker than linen)
        'surface-3': '#E6DFD0',  // deepest recessed fill
        // ─── Ink ──────────────────────────────────────────────────────
        // ink-3 is the floor for TEXT. ink-4 is non-text only (empty
        // checkbox borders, disabled glyphs, hairline outlines).
        ink: '#12100E',
        'ink-2': '#57524A',
        'ink-3': '#8B847A',
        'ink-4': '#B6AFA4',
        // ─── Lines ────────────────────────────────────────────────────
        line: 'rgba(18,16,14,0.09)',
        'line-strong': 'rgba(18,16,14,0.17)',
        'line-strongest': 'rgba(18,16,14,0.34)', // new — strongest hairline
        // ─── Accent (rust, unchanged hue) ─────────────────────────────
        accent: {
          DEFAULT: '#B8442B',
          bg: 'rgba(184,68,43,0.08)',   // legacy fill (kept — existing usages)
          soft: 'rgba(184,68,43,0.09)', // v2 pill fill
          line: 'rgba(184,68,43,0.30)', // v2 pill border
          ink: '#8A3320',               // legacy — still referenced a few places
          slip: '#9C3F26',              // legacy — Briefing day-count numerals
        },
        // ─── Status (v2, new) ─────────────────────────────────────────
        // Used only inside pills. Domain identity colours are NOT here —
        // they're a client-side map keyed by domain id (design handoff).
        warn: {
          DEFAULT: '#96650F',           // due today
          soft: 'rgba(150,101,15,0.10)',
          line: 'rgba(150,101,15,0.28)',
        },
        good: {
          DEFAULT: '#3B6A52',           // on track
          soft: 'rgba(59,106,82,0.10)',
          line: 'rgba(59,106,82,0.26)',
        },
        // Priority-3 ring only (P1=accent, P2=warn, P4=ink-4 reuse existing).
        prio3: '#3F5F86',
      },
      fontFamily: {
        serif: ['Newsreader', 'ui-serif', 'Georgia', 'serif'],
        sans: ['Geist', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        eyebrow: ['10px', { lineHeight: '1.4', letterSpacing: '0.1em' }],
        meta: ['11px', { lineHeight: '1.4' }],
      },
      borderRadius: {
        // v2 uses a 5px radius throughout ("modern but still editorial").
        // `none` stays for the square edges some components still want.
        DEFAULT: '5px',
        none: '0',
      },
    },
  },
  plugins: [],
};

export default config;

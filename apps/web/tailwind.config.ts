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
//
// Dark mode (Aug 2026): every token now points at a CSS variable defined in
// globals.css (`:root` = light linen, `[data-theme='dark']` / system-dark
// media = "Umber", the linen inverted). The hex values quoted in comments
// below are the LIGHT values, kept for grep-ability; the source of truth is
// globals.css. No `dark:` variants exist anywhere — theming is 100% a var
// swap — so Tailwind's `darkMode` setting stays unset.

// A token whose alpha is part of the design value (hairlines, soft pill
// fills). Tailwind hands `opacityValue` a literal ("0.4") for `/40`-style
// modifiers but `var(--tw-*-opacity)` for the bare utility, so: bare usage
// falls through to the token's own alpha; a modifier replaces the alpha —
// exactly what the parsed rgba() literals did before the var conversion
// (border-line/40 has always meant ink at 0.40, not 0.40 × 0.09).
const withDesignAlpha =
  (channels: string, alpha: string): any =>
  ({ opacityValue }: { opacityValue?: string }) =>
    opacityValue !== undefined && !opacityValue.startsWith('var(')
      ? `rgb(var(${channels}) / ${opacityValue})`
      : `rgb(var(${channels}) / var(${alpha}))`;

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
      // Toast entrance — used with motion-safe: so reduced-motion users get
      // an instant appearance instead of the slide.
      keyframes: {
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(-6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'toast-in': 'toast-in 160ms ease-out',
      },
      colors: {
        // ─── Surfaces (light: re-warmed linen, Addendum 10 §4) ────────
        bg: 'rgb(var(--bg) / <alpha-value>)',               // canvas — #F6F2EA light
        surface: 'rgb(var(--surface) / <alpha-value>)',     // rail + lifted-card paper — #FCFAF5
        'surface-2': 'rgb(var(--surface-2) / <alpha-value>)', // recessed fills — #EFE9DD
        'surface-3': 'rgb(var(--surface-3) / <alpha-value>)', // deepest recessed fill — #E6DFD0
        // ─── Ink ──────────────────────────────────────────────────────
        // ink-3 is the floor for TEXT. ink-4 is non-text only (empty
        // checkbox borders, disabled glyphs, hairline outlines).
        ink: 'rgb(var(--ink) / <alpha-value>)',       // #12100E light
        'ink-2': 'rgb(var(--ink-2) / <alpha-value>)', // #57524A
        'ink-3': 'rgb(var(--ink-3) / <alpha-value>)', // #8B847A
        'ink-4': 'rgb(var(--ink-4) / <alpha-value>)', // #B6AFA4
        // ─── Lines (ink-based hairlines; alpha is part of the token) ──
        line: withDesignAlpha('--ink', '--line-a'),                 // ink @ .09 light
        'line-strong': withDesignAlpha('--ink', '--line-strong-a'), // ink @ .17
        'line-strongest': withDesignAlpha('--ink', '--line-strongest-a'), // ink @ .34
        // ─── Accent (rust; dark lifts it one step toward ember) ───────
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)', // #B8442B light
          bg: withDesignAlpha('--accent', '--accent-bg-a'),     // legacy fill (kept — existing usages)
          soft: withDesignAlpha('--accent', '--accent-soft-a'), // v2 pill fill
          line: withDesignAlpha('--accent', '--accent-line-a'), // v2 pill border
          ink: 'rgb(var(--accent-ink) / <alpha-value>)',   // legacy — still referenced a few places
          slip: 'rgb(var(--accent-slip) / <alpha-value>)', // legacy — Briefing day-count numerals
        },
        // ─── Status (v2) ──────────────────────────────────────────────
        // Used only inside pills. Domain identity colours are NOT here —
        // they're a client-side map keyed by domain id (design handoff).
        warn: {
          DEFAULT: 'rgb(var(--warn) / <alpha-value>)', // due today — #96650F light
          soft: withDesignAlpha('--warn', '--warn-soft-a'),
          line: withDesignAlpha('--warn', '--warn-line-a'),
        },
        good: {
          DEFAULT: 'rgb(var(--good) / <alpha-value>)', // on track — #3B6A52 light
          soft: withDesignAlpha('--good', '--good-soft-a'),
          line: withDesignAlpha('--good', '--good-line-a'),
        },
        // Priority-3 ring only (P1=accent, P2=warn, P4=ink-4 reuse existing).
        prio3: 'rgb(var(--prio3) / <alpha-value>)', // #3F5F86 light
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

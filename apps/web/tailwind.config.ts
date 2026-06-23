import type { Config } from 'tailwindcss';

// Design tokens lifted from the mockup canvas (T.* in screens/shared.jsx):
//   serif:    Newsreader
//   sans:     Geist
//   mono:     Geist Mono
//   accent:   #B8442B (rust)
//   surface:  #F6F2EA (warm linen)
// Monochrome editorial palette. Status colors derive from accent + neutrals.

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Design tokens lifted verbatim from the Briefing rethink (June 2026).
        // `surface` is now warm-tinted (was #FFFFFF) — pure white sat too
        // high-contrast against `bg` for the editorial body.
        bg: '#F6F2EA',
        surface: '#FBF8F2',
        'surface-2': '#EFEAE0',
        ink: '#1A1612',
        'ink-2': '#5A544B',
        'ink-3': '#928A7E',
        // Faint / disabled / empty-checkbox / "quiet" status.
        // New in this redesign — all status colors derive from accent + this.
        'ink-4': '#B8B0A2',
        line: 'rgba(26,22,18,0.08)',
        // Stronger hairlines for section rules and borders that need to read.
        'line-strong': 'rgba(26,22,18,0.16)',
        accent: {
          DEFAULT: '#B8442B',
          bg: 'rgba(184,68,43,0.08)',
          ink: '#8A3320',
          // Slightly darker accent for "slipping" — used on the Briefing's
          // large day-count numerals so they don't compete with routing
          // labels.
          slip: '#9C3F26',
        },
      },
      fontFamily: {
        serif: ['Newsreader', 'ui-serif', 'Georgia', 'serif'],
        sans: ['Geist', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        eyebrow: ['10px', { lineHeight: '1.4', letterSpacing: '0.08em' }],
        meta: ['11px', { lineHeight: '1.4' }],
      },
      borderRadius: {
        none: '0',
      },
    },
  },
  plugins: [],
};

export default config;

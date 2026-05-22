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
        bg: '#F6F2EA',
        surface: '#FFFFFF',
        'surface-2': '#EEE8DC',
        ink: '#1A1612',
        'ink-2': '#5A5048',
        'ink-3': '#8B7F73',
        line: 'rgba(26,22,18,0.08)',
        accent: {
          DEFAULT: '#B8442B',
          bg: 'rgba(184,68,43,0.12)',
          ink: '#8A3320',
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

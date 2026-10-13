import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Helvetica Neue"', 'Helvetica', 'Arial', 'sans-serif'],
      },
      fontSize: {
        'xs':   ['13px', { lineHeight: '1.5' }],
        'sm':   ['14px', { lineHeight: '1.5' }],
        'base': ['15px', { lineHeight: '1.6' }],
        'lg':   ['16px', { lineHeight: '1.6' }],
        'xl':   ['18px', { lineHeight: '1.5' }],
        '2xl':  ['20px', { lineHeight: '1.4' }],
        '3xl':  ['24px', { lineHeight: '1.3' }],
      },
      colors: {
        up: {
          DEFAULT: '#e33c3c',
          light: '#fff0f0',
          muted: '#fca5a5',
        },
        down: {
          DEFAULT: '#16a34a',
          light: '#f0fdf4',
          muted: '#86efac',
        },
        neutral: {
          DEFAULT: '#6b7280',
          light: '#f9fafb',
        },
        primary: {
          DEFAULT: '#1d4ed8',
          light: '#eff6ff',
          50:  '#eff6ff',
          100: '#dbeafe',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          900: '#1e3a8a',
        },
        surface: {
          DEFAULT:   'rgb(var(--c-surface) / <alpha-value>)',
          secondary: 'rgb(var(--c-surface-2) / <alpha-value>)',
          tertiary:  'rgb(var(--c-surface-3) / <alpha-value>)',
          border:    'rgb(var(--c-border) / <alpha-value>)',
          bg:        'rgb(var(--c-bg) / <alpha-value>)',
        },
        alert: {
          DEFAULT: '#d97706',
          light:  '#fffbeb',
          border: '#fbbf24',
        },
        // Override slate for better readability (min 13px text baseline)
        slate: {
          50: 'rgb(var(--slate-50) / <alpha-value>)',
          100: 'rgb(var(--slate-100) / <alpha-value>)',
          200: 'rgb(var(--slate-200) / <alpha-value>)',
          300: 'rgb(var(--slate-300) / <alpha-value>)',
          400: 'rgb(var(--slate-400) / <alpha-value>)',
          500: 'rgb(var(--slate-500) / <alpha-value>)',
          600: 'rgb(var(--slate-600) / <alpha-value>)',
          700: 'rgb(var(--slate-700) / <alpha-value>)',
          800: 'rgb(var(--slate-800) / <alpha-value>)',
          900: 'rgb(var(--slate-900) / <alpha-value>)',
        },
      },
      boxShadow: {
        card:       '0 1px 3px 0 rgb(0 0 0 / 0.07), 0 1px 2px -1px rgb(0 0 0 / 0.07)',
        'card-hover': '0 4px 6px -1px rgb(0 0 0 / 0.10), 0 2px 4px -2px rgb(0 0 0 / 0.10)',
      },
    },
  },
  plugins: [],
}

export default config

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Legacy ink palette
        ink: {
          950: '#07111f',
          900: '#0d1b2a',
          800: '#13273c',
        },
        aurora: {
          400: '#7ce3ff',
          500: '#4fc3f7',
          600: '#2493d1',
        },
        // Brand navy palette — forensic dark theme
        brand: {
          bg:       '#080E1C',
          surface:  '#0D1529',
          surface2: '#111F3A',
          border:   '#1E2D4A',
          border2:  '#253454',
        },
        // Cyan brand primary
        cyan: {
          50:  '#ecfeff',
          100: '#cffafe',
          200: '#a5f3fc',
          300: '#67e8f9',
          400: '#22d3ee',
          450: '#10c8c8', // teal-cyan midpoint
          500: '#00C9B8', // brand primary
          600: '#0891b2',
          700: '#0e7490',
          800: '#155e75',
          900: '#164e63',
          950: '#083344',
        },
      },
      fontFamily: {
        mono: ['"IBM Plex Mono"', '"Fira Code"', 'ui-monospace', 'monospace'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
      },
      borderRadius: {
        'xl': '12px',
        '2xl': '16px',
      },
      boxShadow: {
        glow:     '0 0 0 1px rgba(0, 201, 184, 0.18), 0 20px 80px rgba(0, 0, 0, 0.35)',
        'brand':  '0 0 0 3px rgba(0, 201, 184, 0.15)',
        'card':   '0 2px 12px rgba(0, 0, 0, 0.4)',
        'modal':  '0 8px 48px rgba(0, 0, 0, 0.6)',
      },
      animation: {
        'fade-up':  'fade-up 0.35s cubic-bezier(0.16, 1, 0.3, 1) both',
        'fade-in':  'fade-in 0.25s ease both',
        'pulse-ring': 'pulse-ring 1.5s ease-out infinite',
        'scan-line': 'scan-line 8s linear infinite',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        'pulse-ring': {
          '0%':   { boxShadow: '0 0 0 0 rgba(0, 201, 184, 0.4)' },
          '70%':  { boxShadow: '0 0 0 8px rgba(0, 201, 184, 0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(0, 201, 184, 0)' },
        },
        'scan-line': {
          '0%':   { transform: 'translateY(-100%)', opacity: '0.15' },
          '50%':  { opacity: '0.08' },
          '100%': { transform: 'translateY(100vh)', opacity: '0' },
        },
      },
    },
  },
  plugins: [],
}

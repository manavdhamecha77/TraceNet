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
        // Slate extended scale for legacy component compatibility
        slate: {
          50:  '#f8fafc',
          100: '#f1f5f9',
          150: '#e9eff6',
          200: '#e2e8f0',
          250: '#cbd5e1',
          300: '#cbd5e1',
          350: '#94a3b8',
          400: '#94a3b8',
          455: '#64748b',
          500: '#64748b',
          505: '#475569',
          550: '#475569',
          600: '#475569',
          650: '#334155',
          700: '#334155',
          750: '#1e293b',
          800: '#1e293b',
          850: '#0f172a',
          900: '#0f172a',
          925: '#0B1324',
          950: '#020617',
        },
        teal: {
          50:  '#f0fdf4',
          100: '#ccfbf1',
          200: '#99f6e4',
          300: '#5eead4',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
          650: '#0f766e',
          700: '#0f766e',
          750: '#115e59',
          800: '#115e59',
          900: '#134e4a',
          950: '#042f2e',
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

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
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
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(124, 227, 255, 0.18), 0 20px 80px rgba(0, 0, 0, 0.35)',
      },
    },
  },
  plugins: [],
}

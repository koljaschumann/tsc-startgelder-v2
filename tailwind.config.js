/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
      },
      colors: {
        navy: {
          900: '#0a1628',
          800: '#0f2140',
          700: '#162d54',
          600: '#1e3a5f',
        },
        gold: {
          500: '#c49a47',
          400: '#d4a853',
          300: '#e8c777',
          200: '#f0d89a',
        },
        cream: '#faf8f5',
        sea: {
          400: '#5aa3b9',
          300: '#6bb3c9',
          200: '#8bc7d9',
        },
        coral: '#e07b67',
        success: '#4ade80',
        teal: {
          600: '#0d9488',
          500: '#14b8a6',
          400: '#2dd4bf',
          300: '#5eead4',
        },
        light: {
          bg: '#f8fafc',
          card: '#ffffff',
          border: '#e2e8f0',
          text: '#1e293b',
          muted: '#64748b',
        },
      },
    },
  },
  plugins: [],
}

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        sentinel: {
          void: '#000407',
          deep: '#010912',
          panel: '#061525',
          crt: '#00e5ff',
          lime: '#76ff03',
          ember: '#ff6f00',
          blood: '#d50000',
          gold: '#ffd600',
          text: '#b2ebf2',
          muted: '#2e6e87',
          border: '#0e2a44',
        },
      },
      fontFamily: {
        display: ['Bebas Neue', 'Impact', 'sans-serif'],
        mono: ['Space Mono', 'Fira Code', 'monospace'],
        body: ['DM Sans', 'Inter', 'sans-serif'],
      },
      animation: {
        'scanline': 'scanline 8s linear infinite',
        'cursor-blink': 'blink 1s step-end infinite',
        'radar-sweep': 'radar 10s linear infinite',
        'boot-bar': 'bootBar 3s ease-out forwards',
      },
      keyframes: {
        scanline: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
        radar: {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        bootBar: {
          '0%': { width: '0%' },
          '100%': { width: '100%' },
        },
      },
    },
  },
  plugins: [],
};

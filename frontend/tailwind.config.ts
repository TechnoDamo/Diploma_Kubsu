import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}'
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        shell: {
          50: '#f8f9ff',
          100: '#eceffe',
          800: '#151825',
          900: '#0c101b'
        }
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(120, 170, 255, 0.18), 0 20px 60px rgba(5, 12, 30, 0.35)'
      },
      animation: {
        floatIn: 'floatIn 450ms ease-out both',
        pulseSoft: 'pulseSoft 1.6s ease-in-out infinite'
      },
      keyframes: {
        floatIn: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        pulseSoft: {
          '0%, 100%': { opacity: '0.65' },
          '50%': { opacity: '1' }
        }
      }
    }
  },
  plugins: []
};

export default config;

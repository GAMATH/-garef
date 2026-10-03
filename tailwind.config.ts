import type { Config } from 'tailwindcss';

/**
 * Kuzuri design tokens — « africain contemporain ».
 * One action colour per screen: terracotta. Everything else supports it.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      white: '#FFFFFF',
      ink: '#1A1714',
      ivory: '#FAF7F2',
      surface: '#FFFFFF',
      terracotta: { DEFAULT: '#C4532D', dark: '#A3431F', soft: '#F6E4DC' },
      gold: { DEFAULT: '#D9A441', soft: '#F7EBD2', ink: '#7A5512' },
      forest: { DEFAULT: '#2F6B4F', soft: '#DDEBE3' },
      sand: { DEFAULT: '#E8E1D6', light: '#F2EDE5' },
      stone: '#6B645C',
      danger: { DEFAULT: '#B3261E', soft: '#F6DEDC' },
    },
    fontFamily: {
      display: ['Fraunces', 'Georgia', 'serif'],
      sans: ['Manrope', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
    },
    fontSize: {
      xs: ['12px', { lineHeight: '16px' }],
      sm: ['14px', { lineHeight: '20px' }],
      base: ['16px', { lineHeight: '24px' }],
      lg: ['20px', { lineHeight: '28px' }],
      xl: ['24px', { lineHeight: '32px' }],
      '2xl': ['32px', { lineHeight: '38px' }],
      '3xl': ['40px', { lineHeight: '46px' }],
    },
    borderRadius: {
      none: '0',
      sm: '6px',
      DEFAULT: '12px',
      card: '12px',
      lg: '16px',
      full: '999px',
    },
    extend: {
      boxShadow: {
        soft: '0 1px 2px rgba(26,23,20,0.04), 0 4px 16px rgba(26,23,20,0.06)',
        sheet: '0 -8px 32px rgba(26,23,20,0.12)',
      },
      transitionTimingFunction: { out: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      transitionDuration: { 150: '150ms', 200: '200ms', 250: '250ms' },
      keyframes: {
        'fade-up': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'none' } },
        'sheet-in': { from: { transform: 'translateY(100%)' }, to: { transform: 'none' } },
        pop: { '0%': { transform: 'scale(0.6)', opacity: '0' }, '70%': { transform: 'scale(1.06)' }, '100%': { transform: 'scale(1)', opacity: '1' } },
        draw: { from: { strokeDashoffset: '48' }, to: { strokeDashoffset: '0' } },
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
      },
      animation: {
        'fade-up': 'fade-up 200ms cubic-bezier(0.16,1,0.3,1) both',
        'sheet-in': 'sheet-in 250ms cubic-bezier(0.16,1,0.3,1) both',
        pop: 'pop 250ms cubic-bezier(0.16,1,0.3,1) both',
        draw: 'draw 250ms 150ms ease-out both',
        shimmer: 'shimmer 1.4s linear infinite',
      },
      minHeight: { tap: '44px' },
      minWidth: { tap: '44px' },
    },
  },
  plugins: [],
} satisfies Config;

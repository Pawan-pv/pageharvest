import plugin from 'tailwindcss/plugin';

/**
 * PageHarvest design tokens. This is the only place colours, radii and type sizes are defined.
 *
 * Each colour is written to a CSS variable (`--ph-<name>`) for light mode, and redefined
 * under `prefers-color-scheme: dark`. Tailwind utilities read the variables, so a component
 * written once with `bg-surface text-fg` follows the system theme with no `dark:` classes.
 * `tests/unit/ui/design-tokens.test.ts` holds every text and UI pair to WCAG AA in both themes.
 *
 * Names are `group` or `group-key`: `fg-muted` is the utility `text-fg-muted`.
 */
export const designTokens = {
  colors: {
    light: {
      canvas: '#f6f7f6',
      surface: '#ffffff',
      'surface-sunken': '#f0f2f1',
      'surface-muted': '#e7ebe9',
      'surface-strong': '#d5dcd8',
      fg: '#111614',
      'fg-muted': '#414c46',
      'fg-subtle': '#58645d',
      'fg-faint': '#6e7a74',
      'line-subtle': '#eaeceb',
      line: '#dce1de',
      'line-strong': '#6e7a74',
      inverse: '#171d1a',
      'inverse-hover': '#0d110f',
      'inverse-active': '#050706',
      'on-strong': '#ffffff',
      brand: '#057a55',
      'brand-hover': '#046244',
      'brand-active': '#034c34',
      'brand-soft': '#ebf6f1',
      'brand-line': '#b5dfd0',
      'brand-fg': '#046c4b',
      'brand-emphasis': '#034832',
      danger: '#c0183c',
      'danger-hover': '#9f1239',
      'danger-active': '#881337',
      'danger-soft': '#fef1f3',
      'danger-line': '#fbcad3',
      'danger-fg': '#b81438',
      'danger-emphasis': '#821029',
      warning: '#a9520a',
      'warning-hover': '#8c4106',
      'warning-active': '#713304',
      'warning-soft': '#fdf8ec',
      'warning-line': '#f7dc9e',
      'warning-fg': '#964606',
      'warning-emphasis': '#703304',
      info: '#0369a1',
      'info-hover': '#075985',
      'info-active': '#0c4a6e',
      'info-soft': '#eff7fc',
      'info-line': '#b7dcf5',
      'info-fg': '#03669c',
      'info-emphasis': '#0c4a6e',
      focus: '#2563eb',
      scrim: '#0d110f',
      // Architectural Vellum elevated dock surfaces.
      dock: '#ecefed',
      'dock-solid': '#ecefed',
      hairline: '#0f172a',
      'on-accent': '#ffffff',
      'tool-emerald': '#057a55',
      'tool-teal': '#0d7470',
      'tool-cyan': '#0c718c',
      'tool-sky': '#1d64b8',
      'tool-indigo': '#4645b8',
      'tool-violet': '#6b46c1',
      'tool-green': '#197744',
      'tool-lime': '#477514',
      'tool-amber': '#a95b0d',
      'tool-slate': '#475569',
    },
    dark: {
      canvas: '#090b0d',
      surface: '#111418',
      'surface-sunken': '#0d1013',
      'surface-muted': '#181c22',
      'surface-strong': '#232830',
      fg: '#f2f5f3',
      'fg-muted': '#c0c8d0',
      'fg-subtle': '#919ba7',
      'fg-faint': '#788392',
      'line-subtle': '#191e24',
      line: '#252b34',
      'line-strong': '#788392',
      inverse: '#e6ebe8',
      'inverse-hover': '#f5f7f6',
      'inverse-active': '#ffffff',
      'on-strong': '#08110d',
      brand: '#22c58b',
      'brand-hover': '#3fd49e',
      'brand-active': '#7ae6be',
      'brand-soft': '#0d251d',
      'brand-line': '#1b4d3b',
      'brand-fg': '#3ad19b',
      'brand-emphasis': '#a7f3d0',
      danger: '#f44d6a',
      'danger-hover': '#fb7185',
      'danger-active': '#fda4af',
      'danger-soft': '#2b1018',
      'danger-line': '#6f1a2f',
      'danger-fg': '#fda4af',
      'danger-emphasis': '#fecdd3',
      warning: '#f5a623',
      'warning-hover': '#fbbf24',
      'warning-active': '#fde68a',
      'warning-soft': '#271c08',
      'warning-line': '#69450d',
      'warning-fg': '#fcd34d',
      'warning-emphasis': '#fde68a',
      info: '#38bdf8',
      'info-hover': '#7dd3fc',
      'info-active': '#bae6fd',
      'info-soft': '#0c2130',
      'info-line': '#1a4a6b',
      'info-fg': '#7dd3fc',
      'info-emphasis': '#bae6fd',
      focus: '#60a5fa',
      scrim: '#000000',
      dock: '#14181e',
      'dock-solid': '#14181e',
      hairline: '#ffffff',
      'on-accent': '#ffffff',
      'tool-emerald': '#34d399',
      'tool-teal': '#2dd4bf',
      'tool-cyan': '#38cbd8',
      'tool-sky': '#60a5fa',
      'tool-indigo': '#818cf8',
      'tool-violet': '#a78bfa',
      'tool-green': '#4ade80',
      'tool-lime': '#a3d944',
      'tool-amber': '#f5b038',
      'tool-slate': '#94a3b8',
    },
  },
  radius: {
    control: '0.5rem',
    card: '0.75rem',
    pill: '9999px',
  },
  spacing: {
    gutter: '1rem',
  },
  fontFamily: {
    sans: [
      'Inter',
      'SF Pro Text',
      'Segoe UI Variable Text',
      'Segoe UI',
      '-apple-system',
      'BlinkMacSystemFont',
      'system-ui',
      'sans-serif',
    ],
    mono: [
      'JetBrains Mono',
      'Cascadia Code',
      'SF Mono',
      'ui-monospace',
      'SFMono-Regular',
      'Menlo',
      'Consolas',
      'monospace',
    ],
  },
  fontSize: {
    // 11px is the smallest text the panel uses; nothing goes below it.
    '2xs': ['0.6875rem', { lineHeight: '1rem' }],
    // 13px: the smallest size for sentences a beginner has to read (ADR-039).
    body: ['0.8125rem', { lineHeight: '1.1875rem' }],
  },
};

function hexToChannels(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(' ');
}

function cssVariables(palette) {
  return Object.fromEntries(
    Object.entries(palette).map(([name, hex]) => [`--ph-${name}`, hexToChannels(hex)])
  );
}

function tailwindColors(names) {
  const colors = {};
  for (const name of names) {
    const [group, ...rest] = name.split('-');
    const key = rest.length > 0 ? rest.join('-') : 'DEFAULT';
    colors[group] = colors[group] ?? {};
    colors[group][key] = `rgb(var(--ph-${name}) / <alpha-value>)`;
  }
  return colors;
}

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./entrypoints/**/*.{html,ts,tsx}', './src/**/*.{html,ts,tsx}'],
  darkMode: 'media',
  theme: {
    extend: {
      colors: tailwindColors(Object.keys(designTokens.colors.light)),
      borderRadius: designTokens.radius,
      spacing: designTokens.spacing,
      fontFamily: designTokens.fontFamily,
      fontSize: designTokens.fontSize,
      boxShadow: {
        xs: '0 1px 2px 0 rgb(var(--ph-scrim) / 0.05)',
        dock: '0 4px 16px -4px rgb(var(--ph-scrim) / 0.12), 0 1px 2px 0 rgb(var(--ph-scrim) / 0.06)',
        'glow-emerald': '0 4px 18px -6px rgb(var(--ph-tool-emerald) / 0.25)',
        'glow-teal': '0 4px 18px -6px rgb(var(--ph-tool-teal) / 0.25)',
        'glow-cyan': '0 4px 18px -6px rgb(var(--ph-tool-cyan) / 0.25)',
        'glow-sky': '0 4px 18px -6px rgb(var(--ph-tool-sky) / 0.25)',
        'glow-indigo': '0 4px 18px -6px rgb(var(--ph-tool-indigo) / 0.25)',
        'glow-violet': '0 4px 18px -6px rgb(var(--ph-tool-violet) / 0.25)',
        'glow-green': '0 4px 18px -6px rgb(var(--ph-tool-green) / 0.25)',
        'glow-lime': '0 4px 18px -6px rgb(var(--ph-tool-lime) / 0.25)',
        'glow-amber': '0 4px 18px -6px rgb(var(--ph-tool-amber) / 0.25)',
        'glow-slate': '0 4px 18px -6px rgb(var(--ph-tool-slate) / 0.25)',
      },
      backdropBlur: {
        xs: '2px',
      },
      ringColor: {
        DEFAULT: 'rgb(var(--ph-focus) / <alpha-value>)',
      },
      // The gap between a focus ring and its control matches the surface it sits on.
      ringOffsetColor: {
        DEFAULT: 'rgb(var(--ph-surface) / <alpha-value>)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'ph-orbit-slow': {
          from: { transform: 'rotate(0deg)' },
          to: { transform: 'rotate(360deg)' },
        },
        'ph-ring-spin': {
          from: { transform: 'rotate(0deg)' },
          to: { transform: 'rotate(360deg)' },
        },
        'ph-harvest-pulse': {
          '0%': { transform: 'scale(1)', opacity: '0.45' },
          '100%': { transform: 'scale(1.18)', opacity: '0' },
        },
        'ph-tick-up': {
          '0%': { transform: 'translateY(4px)', opacity: '0.7' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'ph-row-enter': {
          '0%': { transform: 'translateY(6px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'ph-scan-beam': {
          '0%': { transform: 'translateX(-100%)', opacity: '0.25' },
          '50%': { opacity: '1' },
          '100%': { transform: 'translateX(260%)', opacity: '0.25' },
        },
        'ph-spark-burst': {
          '0%': { transform: 'translateY(2px) scale(0.4)', opacity: '0' },
          '28%': { transform: 'translateY(-6px) scale(1)', opacity: '1' },
          '100%': { transform: 'translateY(-13px) scale(0.25)', opacity: '0' },
        },
        'ph-cta-sheen': {
          '0%': { transform: 'translateX(-120%) skewX(-20deg)', opacity: '0' },
          '25%': { opacity: '0.45' },
          '80%': { opacity: '0.45' },
          '100%': { transform: 'translateX(260%) skewX(-20deg)', opacity: '0' },
        },
        'ph-aura-breathe': {
          '0%, 100%': { opacity: '0.35', transform: 'scale(1)' },
          '50%': { opacity: '0.7', transform: 'scale(1.05)' },
        },
        'ph-radar-ping': {
          '0%': { transform: 'scale(0.85)', opacity: '0.85' },
          '70%, 100%': { transform: 'scale(2.2)', opacity: '0' },
        },
        'ph-pop-in': {
          '0%': { opacity: '0', transform: 'scale(0.92)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'ph-check-draw': {
          '0%': { strokeDashoffset: '100' },
          '100%': { strokeDashoffset: '0' },
        },
        'ph-shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'scale-in': 'scale-in 150ms ease-out',
        'ph-orbit-slow': 'ph-orbit-slow 14s linear infinite',
        'ph-ring-spin': 'ph-ring-spin 1.8s linear infinite',
        'ph-harvest-pulse': 'ph-harvest-pulse 650ms cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'ph-tick-up': 'ph-tick-up 160ms cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'ph-row-enter': 'ph-row-enter 220ms cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'ph-scan-beam': 'ph-scan-beam 2.2s ease-in-out infinite',
        'ph-spark-burst': 'ph-spark-burst 750ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'ph-cta-sheen': 'ph-cta-sheen 900ms cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'ph-aura-breathe': 'ph-aura-breathe 3s ease-in-out infinite',
        'ph-radar-ping': 'ph-radar-ping 2s cubic-bezier(0, 0, 0.2, 1) infinite',
        'ph-pop-in': 'ph-pop-in 180ms cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'ph-check-draw': 'ph-check-draw 450ms ease-out forwards',
        'ph-shimmer': 'ph-shimmer 2s linear infinite',
      },
    },
  },
  plugins: [
    plugin(({ addBase }) => {
      addBase({
        ':root': cssVariables(designTokens.colors.light),
        '@media (prefers-color-scheme: dark)': {
          ':root': cssVariables(designTokens.colors.dark),
        },
      });
    }),
  ],
};

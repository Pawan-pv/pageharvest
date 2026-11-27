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
      canvas: '#f6f9f7',
      surface: '#ffffff',
      'surface-sunken': '#f1f5f3',
      'surface-muted': '#edf3f0',
      'surface-strong': '#dbe4df',
      fg: '#0f172a',
      'fg-muted': '#475569',
      'fg-subtle': '#56657a',
      'fg-faint': '#738297',
      'line-subtle': '#edf3f0',
      line: '#dbe4df',
      'line-strong': '#738297',
      inverse: '#1e293b',
      'inverse-hover': '#0f172a',
      'inverse-active': '#020617',
      'on-strong': '#ffffff',
      brand: '#047857',
      'brand-hover': '#065f46',
      'brand-active': '#064e3b',
      'brand-soft': '#ecfdf5',
      'brand-line': '#a7f3d0',
      'brand-fg': '#047857',
      'brand-emphasis': '#064e3b',
      danger: '#be123c',
      'danger-hover': '#9f1239',
      'danger-active': '#881337',
      'danger-soft': '#fff1f2',
      'danger-line': '#fecdd3',
      'danger-fg': '#be123c',
      'danger-emphasis': '#881337',
      warning: '#b45309',
      'warning-hover': '#92400e',
      'warning-active': '#78350f',
      'warning-soft': '#fffbeb',
      'warning-line': '#fde68a',
      'warning-fg': '#b45309',
      'warning-emphasis': '#78350f',
      info: '#0369a1',
      'info-hover': '#075985',
      'info-active': '#0c4a6e',
      'info-soft': '#f0f9ff',
      'info-line': '#bae6fd',
      'info-fg': '#0369a1',
      'info-emphasis': '#0c4a6e',
      focus: '#2563eb',
      scrim: '#0f172a',
      // Botanical Paper elevated/dock surfaces.
      dock: '#edf3f0',
      'dock-solid': '#edf3f0',
      hairline: '#cbd5e1',
      'on-accent': '#ffffff',
      'tool-emerald': '#047857',
      'tool-teal': '#0f766e',
      'tool-cyan': '#0e7490',
      'tool-sky': '#0369a1',
      'tool-indigo': '#4338ca',
      'tool-violet': '#6d28d9',
      'tool-green': '#15803d',
      'tool-lime': '#4d7c0f',
      'tool-amber': '#b45309',
      'tool-slate': '#475569',
    },
    dark: {
      canvas: '#070a0f',
      surface: '#0f141d',
      'surface-sunken': '#0b0f16',
      'surface-muted': '#161e2b',
      'surface-strong': '#222d3f',
      fg: '#f8fafc',
      'fg-muted': '#cbd5e1',
      'fg-subtle': '#94a3b8',
      'fg-faint': '#6b7a90',
      'line-subtle': '#161e2b',
      line: '#1f293a',
      'line-strong': '#6b7a90',
      inverse: '#e2e8f0',
      'inverse-hover': '#f8fafc',
      'inverse-active': '#ffffff',
      'on-strong': '#0b1220',
      brand: '#00e599',
      'brand-hover': '#10f2a7',
      'brand-active': '#6ee7b7',
      'brand-soft': '#05281e',
      'brand-line': '#065f46',
      'brand-fg': '#00e599',
      'brand-emphasis': '#a7f3d0',
      danger: '#fb7185',
      'danger-hover': '#fda4af',
      'danger-active': '#fecdd3',
      'danger-soft': '#2a0e16',
      'danger-line': '#881337',
      'danger-fg': '#fda4af',
      'danger-emphasis': '#fecdd3',
      warning: '#f59e0b',
      'warning-hover': '#fbbf24',
      'warning-active': '#fde68a',
      'warning-soft': '#2a1d06',
      'warning-line': '#78350f',
      'warning-fg': '#fcd34d',
      'warning-emphasis': '#fde68a',
      info: '#38bdf8',
      'info-hover': '#7dd3fc',
      'info-active': '#bae6fd',
      'info-soft': '#082236',
      'info-line': '#0c4a6e',
      'info-fg': '#7dd3fc',
      'info-emphasis': '#bae6fd',
      focus: '#60a5fa',
      scrim: '#000000',
      dock: '#161e2b',
      'dock-solid': '#161e2b',
      hairline: '#ffffff',
      'on-accent': '#ffffff',
      'tool-emerald': '#00e599',
      'tool-teal': '#14b8a6',
      'tool-cyan': '#22d3ee',
      'tool-sky': '#38bdf8',
      'tool-indigo': '#818cf8',
      'tool-violet': '#a78bfa',
      'tool-green': '#4ade80',
      'tool-lime': '#a3e635',
      'tool-amber': '#f59e0b',
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
  fontSize: {
    // 11px is the smallest text the panel uses; nothing goes below it.
    '2xs': ['0.6875rem', { lineHeight: '1rem' }],
    // 13px: the smallest size for sentences a beginner has to read (ADR-039).
    body: ['0.8125rem', { lineHeight: '1.125rem' }],
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
      fontSize: designTokens.fontSize,
      boxShadow: {
        xs: '0 1px 2px 0 rgb(var(--ph-scrim) / 0.06)',
        'glow-emerald': '0 0 20px -6px rgb(var(--ph-tool-emerald) / 0.35)',
        'glow-teal': '0 0 20px -6px rgb(var(--ph-tool-teal) / 0.35)',
        'glow-cyan': '0 0 20px -6px rgb(var(--ph-tool-cyan) / 0.35)',
        'glow-sky': '0 0 20px -6px rgb(var(--ph-tool-sky) / 0.35)',
        'glow-indigo': '0 0 20px -6px rgb(var(--ph-tool-indigo) / 0.35)',
        'glow-violet': '0 0 20px -6px rgb(var(--ph-tool-violet) / 0.35)',
        'glow-green': '0 0 20px -6px rgb(var(--ph-tool-green) / 0.35)',
        'glow-lime': '0 0 20px -6px rgb(var(--ph-tool-lime) / 0.35)',
        'glow-amber': '0 0 20px -6px rgb(var(--ph-tool-amber) / 0.35)',
        'glow-slate': '0 0 20px -6px rgb(var(--ph-tool-slate) / 0.35)',
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

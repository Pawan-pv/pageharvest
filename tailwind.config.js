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
      canvas: '#f8fafc',
      surface: '#ffffff',
      'surface-sunken': '#f8fafc',
      'surface-muted': '#f1f5f9',
      'surface-strong': '#e2e8f0',
      fg: '#0f172a',
      'fg-muted': '#475569',
      'fg-subtle': '#56657a',
      'fg-faint': '#7b8aa0',
      'line-subtle': '#f1f5f9',
      line: '#e2e8f0',
      'line-strong': '#7b8aa0',
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
    },
    dark: {
      canvas: '#020617',
      surface: '#0f172a',
      'surface-sunken': '#0b1220',
      'surface-muted': '#1e293b',
      'surface-strong': '#334155',
      fg: '#f8fafc',
      'fg-muted': '#cbd5e1',
      'fg-subtle': '#94a3b8',
      'fg-faint': '#6b7a90',
      'line-subtle': '#1e293b',
      line: '#334155',
      'line-strong': '#6b7a90',
      inverse: '#e2e8f0',
      'inverse-hover': '#f8fafc',
      'inverse-active': '#ffffff',
      'on-strong': '#0b1220',
      brand: '#34d399',
      'brand-hover': '#6ee7b7',
      'brand-active': '#a7f3d0',
      'brand-soft': '#06261f',
      'brand-line': '#065f46',
      'brand-fg': '#34d399',
      'brand-emphasis': '#a7f3d0',
      danger: '#fb7185',
      'danger-hover': '#fda4af',
      'danger-active': '#fecdd3',
      'danger-soft': '#2a0e16',
      'danger-line': '#881337',
      'danger-fg': '#fda4af',
      'danger-emphasis': '#fecdd3',
      warning: '#fbbf24',
      'warning-hover': '#fcd34d',
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
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'scale-in': 'scale-in 150ms ease-out',
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

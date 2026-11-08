import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import tailwindConfig, { designTokens, type ThemeName } from '../../../tailwind.config.js';

/**
 * The side panel's colours, radii and type sizes are defined once, in tailwind.config.js.
 * These tests hold that single source to WCAG AA in both themes and keep the UI code from
 * drifting back to raw palette classes, which would not follow dark mode.
 */
const ROOT = resolve(__dirname, '../../..');
const THEMES: ThemeName[] = ['light', 'dark'];

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function token(theme: ThemeName, path: string): string {
  const value = designTokens.colors[theme][path];
  if (!value) throw new Error(`Missing ${theme} token "${path}"`);
  return value;
}

const BACKGROUNDS = ['canvas', 'surface', 'surface-sunken', 'surface-muted'];
const TONES = ['brand', 'danger', 'warning', 'info'] as const;

/** [foreground, background, minimum ratio]: body text needs 4.5:1, UI boundaries 3:1. */
const PAIRS: [string, string, number][] = [
  ...['fg', 'fg-muted', 'fg-subtle'].flatMap((fg) =>
    BACKGROUNDS.map((bg): [string, string, number] => [fg, bg, 4.5])
  ),
  ...['inverse', 'inverse-hover', ...TONES, ...TONES.map((tone) => `${tone}-hover`)].map(
    (bg): [string, string, number] => ['on-strong', bg, 4.5]
  ),
  ...TONES.flatMap((tone) =>
    [`${tone}-fg`, `${tone}-emphasis`].flatMap((fg) =>
      [`${tone}-soft`, 'surface', 'canvas'].map((bg): [string, string, number] => [fg, bg, 4.5])
    )
  ),
  ...BACKGROUNDS.flatMap((bg) => [
    ['focus', bg, 3] as [string, string, number],
    ['line-strong', bg, 3] as [string, string, number],
    ['fg-faint', bg, 3] as [string, string, number],
    ['brand', bg, 3] as [string, string, number],
  ]),
];

describe('Design tokens', () => {
  it('defines the same token names for light and dark', () => {
    expect(Object.keys(designTokens.colors.dark).sort()).toEqual(
      Object.keys(designTokens.colors.light).sort()
    );
  });

  it.each(THEMES)('meets WCAG AA for every text and UI pair in %s mode', (theme) => {
    const failures = PAIRS.filter(([fg, bg, min]) => contrast(token(theme, fg), token(theme, bg)) < min).map(
      ([fg, bg, min]) =>
        `${fg} on ${bg}: ${contrast(token(theme, fg), token(theme, bg)).toFixed(2)} < ${min}`
    );
    expect(failures).toEqual([]);
  });

  it('exposes every colour to Tailwind through a CSS variable', () => {
    const colors = tailwindConfig.theme.extend.colors;
    for (const name of Object.keys(designTokens.colors.light)) {
      const [group, ...rest] = name.split('-');
      const key = rest.length > 0 ? rest.join('-') : 'DEFAULT';
      const entry = colors[group];
      const value = typeof entry === 'string' ? entry : entry?.[key];
      expect(value, name).toBe(`rgb(var(--ph-${name}) / <alpha-value>)`);
    }
  });

  it('follows the system colour scheme', () => {
    expect(tailwindConfig.darkMode).toBe('media');
    const css = readFileSync(join(ROOT, 'entrypoints/sidepanel/style.css'), 'utf8');
    expect(css).toMatch(/color-scheme:\s*light dark/);
  });

  it('turns off animation and transitions when the user prefers reduced motion', () => {
    const css = readFileSync(join(ROOT, 'entrypoints/sidepanel/style.css'), 'utf8');
    const block = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/);
    expect(block?.[1]).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(block?.[1]).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
  });

  it('shows a visible focus ring on every focusable element', () => {
    const css = readFileSync(join(ROOT, 'entrypoints/sidepanel/style.css'), 'utf8');
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid rgb\(var\(--ph-focus\)\)/);
  });
});

function listUiFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listUiFiles(path) : /\.(tsx?|html)$/.test(name) ? [path] : [];
  });
}

const UI_FILES = [join(ROOT, 'entrypoints/sidepanel'), join(ROOT, 'src/components')].flatMap(listUiFiles);

describe('Side panel styling uses the tokens', () => {
  it('uses no raw palette colour classes, which would not follow dark mode', () => {
    const raw =
      /\b(?:bg|text|border|ring|from|to|via|divide|placeholder|outline|fill|stroke|accent|decoration)-(?:white|black|slate|gray|zinc|neutral|emerald|green|rose|red|amber|yellow|sky|blue|indigo|violet|purple|teal|cyan|orange)(?:-\d{2,3})?(?:\/\d{1,3})?\b/g;
    const offenders = UI_FILES.flatMap((file) =>
      Array.from(readFileSync(file, 'utf8').matchAll(raw), (m) => `${relative(ROOT, file)}: ${m[0]}`)
    );
    expect(offenders).toEqual([]);
  });

  it('uses no classes that Tailwind 3 does not generate', () => {
    const dead = /(?<![\w-])(?:animate-in|fade-in|zoom-in-\d+|py-0\.2|text-\[\d+px\])(?![\w-])/g;
    const offenders = UI_FILES.flatMap((file) =>
      Array.from(readFileSync(file, 'utf8').matchAll(dead), (m) => `${relative(ROOT, file)}: ${m[0]}`)
    );
    expect(offenders).toEqual([]);
  });

  it('defines the small shadow and blur the components rely on', () => {
    expect(tailwindConfig.theme.extend.boxShadow.xs).toBeTruthy();
    expect(tailwindConfig.theme.extend.backdropBlur.xs).toBeTruthy();
    expect(tailwindConfig.theme.extend.fontSize['2xs']).toBeTruthy();
  });
});

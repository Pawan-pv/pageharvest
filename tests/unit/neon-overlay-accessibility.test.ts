import { afterEach, describe, expect, it, vi } from 'vitest';
import { PickerOverlay } from '@/content/picker/overlay';
import { ExtractionVisualOverlay } from '@/content/extraction-visual-overlay';

/**
 * Both overlays draw over arbitrary pages, so every indicator and every line of text is
 * checked against a light host page and a dark one. Stylesheets are read from inside the
 * closed shadow roots, recorded as they attach; production exposes nothing.
 */
const HOSTS = { light: [255, 255, 255], dark: [18, 18, 18] } as const;
type Rgb = readonly [number, number, number];

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function luminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Parses #rrggbb or rgba(), flattening any transparency over the backdrop it sits on. */
function parseColor(value: string, backdrop: Rgb): Rgb {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)) as unknown as Rgb;
  const rgba = value.match(/rgba?\(([^)]+)\)/);
  if (!rgba) throw new Error(`unparsed colour ${value}`);
  const [r, g, b, a = 1] = rgba[1].split(',').map((part) => Number(part.trim()));
  return [r, g, b].map((c, i) => Math.round(c * a + backdrop[i] * (1 - a))) as unknown as Rgb;
}

function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = css.match(new RegExp(`(?:^|[\\s}])${escaped}\\s*\\{([^}]*)\\}`));
  if (!found) throw new Error(`no rule for ${selector}`);
  return found[1];
}

function declared(declarations: string, property: string): string {
  const found = declarations.match(new RegExp(`(?:^|[\\s;])${property}:\\s*([^;!]+)`));
  if (!found) throw new Error(`no ${property}`);
  return found[1].trim();
}

/** The colour inside a border or outline shorthand such as "2px solid #00f5d4". */
function strokeColor(value: string): string {
  const found = value.match(/(#[0-9a-f]{6}|rgba?\([^)]+\))/i);
  if (!found) throw new Error(`no colour in ${value}`);
  return found[1];
}

function capture(): () => string {
  const roots: ShadowRoot[] = [];
  const original = Element.prototype.attachShadow;
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init: ShadowRootInit) {
    const root = original.call(this, init);
    roots.push(root);
    return root;
  });
  return () => roots.flatMap((root) => Array.from(root.querySelectorAll('style'), (s) => s.textContent ?? '')).join('\n');
}

function pickerCss(): string {
  const read = capture();
  const overlay = new PickerOverlay();
  overlay.attach();
  const css = read();
  overlay.destroy();
  return css;
}

function scanCss(): string {
  const read = capture();
  const overlay = new ExtractionVisualOverlay();
  overlay.attach();
  const css = read();
  overlay.destroy();
  return css;
}

const INDICATORS: [string, () => string, string][] = [
  ['picker hover box', pickerCss, '.ph-hover-box'],
  ['picker selection box', pickerCss, '.ph-selection-box'],
  ['picker similar items', pickerCss, '.ph-similar-box'],
  ['scan box', scanCss, '.px-scan-box'],
];

describe('Neon overlays on light and dark pages', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(INDICATORS)('the %s stays visible (3:1) on a light and a dark page', (_name, css, selector) => {
    const declarations = rule(css(), selector);
    const neon = strokeColor(declared(declarations, 'border'));
    const ring = strokeColor(declared(declarations, 'outline'));
    for (const [host, backdrop] of Object.entries(HOSTS)) {
      const best = Math.max(contrast(parseColor(neon, backdrop), backdrop), contrast(parseColor(ring, backdrop), backdrop));
      expect(best, `${selector} on a ${host} page`).toBeGreaterThanOrEqual(3);
    }
  });

  it.each([
    ['picker hover badge', pickerCss, '.ph-hover-badge'],
    ['picker selection badge', pickerCss, '.ph-selection-badge'],
    ['scan badge', scanCss, '.px-scan-badge'],
    ['scan progress display', scanCss, '.px-hud'],
  ] as const)('the %s text meets 4.5:1 on its panel over a light and a dark page', (_name, css, selector) => {
    const declarations = rule(css(), selector);
    const panel = declared(declarations, declarations.includes('background-color') ? 'background-color' : 'background');
    const text = declared(declarations, 'color');
    for (const backdrop of Object.values(HOSTS)) {
      const behind = parseColor(panel, backdrop);
      expect(contrast(parseColor(text, behind), behind)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each([
    ['picker overlay', pickerCss],
    ['scan overlay', scanCss],
  ] as const)('the %s stops every animation and transition, its host included, for reduced motion', (_name, css) => {
    const sheet = css();
    expect(sheet).toMatch(/@keyframes/);
    const block = sheet.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\}\s*\}/)?.[1] ?? '';
    expect(block).toMatch(/:host/);
    expect(block).toMatch(/\*::after/);
    expect(block).toMatch(/animation:\s*none\s*!important/);
    expect(block).toMatch(/transition:\s*none\s*!important/);
  });
});

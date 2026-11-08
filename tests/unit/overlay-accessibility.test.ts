import { afterEach, describe, expect, it, vi } from 'vitest';
import { PickerOverlay } from '@/content/picker/overlay';

const HOST_ID = 'pageharvest-picker-overlay-host';

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

/** The overlay's stylesheet, read from inside its closed root the way the existing tests do. */
function overlayCss(): string {
  const attachShadow = vi.spyOn(Element.prototype, 'attachShadow');
  const overlay = new PickerOverlay();
  overlay.attach();
  const root = attachShadow.mock.results[0].value as ShadowRoot;
  const css = Array.from(root.querySelectorAll('style'), (style) => style.textContent ?? '').join('\n');
  overlay.destroy();
  return css;
}

function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
}

function hexIn(declarations: string, property: string): string {
  // Anchored, so `color` does not match inside `background-color`.
  return declarations.match(new RegExp(`(?:^|[\\s;])${property}:\\s*(#[0-9a-fA-F]{6})`))?.[1] ?? '';
}

describe('Picker overlay accessibility', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.getElementById(HOST_ID)?.remove();
  });

  it('stops animation and transitions for people who prefer reduced motion', () => {
    const css = overlayCss();
    const block = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\}\s*\}/)?.[1] ?? '';
    expect(block).toMatch(/animation:\s*none\s*!important/);
    expect(block).toMatch(/transition:\s*none\s*!important/);
  });

  it('shows a visible focus ring on its buttons when reached by keyboard', () => {
    const css = overlayCss();
    expect(rule(css, '.ph-btn:focus-visible')).toMatch(/outline:\s*2px solid #[0-9a-fA-F]{6}\s*!important/);
    expect(rule(css, '.ph-breadcrumb-item:focus-visible')).toMatch(/outline:\s*2px solid/);
  });

  it('gives its buttons text that meets WCAG AA', () => {
    const css = overlayCss();
    const primary = rule(css, '.ph-btn-primary');
    expect(contrast(hexIn(primary, 'color'), hexIn(primary, 'background-color'))).toBeGreaterThanOrEqual(4.5);
    const primaryHover = rule(css, '.ph-btn-primary:hover');
    expect(contrast(hexIn(primary, 'color'), hexIn(primaryHover, 'background-color'))).toBeGreaterThanOrEqual(4.5);
    // The toolbar is slate-900 at 94% opacity over the page; its darkest backing is slate-900.
    expect(contrast(hexIn(rule(css, '.ph-btn-cancel'), 'color'), '#0f172a')).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps every style inside the closed root, leaking nothing into the page', () => {
    const before = document.head.querySelectorAll('style, link[rel="stylesheet"]').length;
    const overlay = new PickerOverlay();
    overlay.attach();
    expect(document.head.querySelectorAll('style, link[rel="stylesheet"]').length).toBe(before);
    expect(document.body.querySelectorAll('style').length).toBe(0);
    overlay.destroy();
  });
});

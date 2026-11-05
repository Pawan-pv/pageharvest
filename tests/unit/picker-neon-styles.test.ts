import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PickerOverlay } from '@/content/picker/overlay';
import { HoverElementInfo, SelectedElementInfo } from '@/content/picker/types';

/**
 * The picker's root is closed. This records each root as it is attached so the test
 * can read the injected stylesheet and rendered elements. Production exposes nothing.
 */
const attachedRoots = new WeakMap<Element, ShadowRoot>();
const originalAttachShadow = Element.prototype.attachShadow;

function overlayRootOf(host: Element): ShadowRoot {
  const root = attachedRoots.get(host);
  if (!root) throw new Error('The picker attached no shadow root.');
  return root;
}

function rectOf(top: number, left: number, width: number, height: number): DOMRect {
  return {
    top,
    left,
    width,
    height,
    bottom: top + height,
    right: left + width,
    x: left,
    y: top,
    toJSON: () => {},
  } as DOMRect;
}

describe('Picker overlay neon styles', () => {
  let overlay: PickerOverlay;

  it('lets the hidden state beat the toolbar display rule in the cascade', () => {
    overlay = new PickerOverlay();
    overlay.attach();

    const host = document.getElementById('pageharvest-picker-overlay-host')!;
    const styleText = overlayRootOf(host).querySelector('style')!.textContent ?? '';

    // Both rules are !important with display values, so specificity must decide:
    // a bare `.ph-hidden` loses to the later `.ph-toolbar { display: flex }`.
    expect(styleText).toMatch(/\.ph-root-container \.ph-hidden \{\s*display: none !important;/);
    expect(styleText).toContain('display: flex !important');
  });

  beforeEach(() => {
    Element.prototype.attachShadow = function attachAndRecord(this: Element, init: ShadowRootInit) {
      const root = originalAttachShadow.call(this, init);
      attachedRoots.set(this, root);
      return root;
    };
    document.body.innerHTML = '';
  });

  afterEach(() => {
    Element.prototype.attachShadow = originalAttachShadow;
    overlay?.destroy();
    document.getElementById('pageharvest-picker-overlay-host')?.remove();
    document.body.innerHTML = '';
  });

  it('keeps the shadow isolation reset contract', () => {
    overlay = new PickerOverlay();
    overlay.attach();

    const root = overlayRootOf(document.getElementById('pageharvest-picker-overlay-host')!);
    const style = root.querySelector('style')!.textContent ?? '';

    expect(style).toContain(':host');
    expect(style).toContain('all: initial !important');
  });

  it('styles the hover box with the electric cyan neon aesthetic', () => {
    overlay = new PickerOverlay();
    overlay.attach();
    const root = overlayRootOf(document.getElementById('pageharvest-picker-overlay-host')!);
    const style = root.querySelector('style')!.textContent ?? '';

    expect(style).toContain('#00f5d4');
    expect(style).toContain('0 0 14px rgba(0, 245, 212, 0.75), inset 0 0 10px rgba(0, 245, 212, 0.2)');
    expect(style).toContain('80ms');
  });

  it('styles the tooltip badge as dark glassmorphic neon', () => {
    overlay = new PickerOverlay();
    overlay.attach();
    const root = overlayRootOf(document.getElementById('pageharvest-picker-overlay-host')!);
    const style = root.querySelector('style')!.textContent ?? '';

    expect(style).toContain('rgba(10, 15, 28, 0.92)');
    expect(style).toContain('backdrop-filter: blur(8px)');
  });

  it('styles selection and similar highlights with the emerald/violet pulse', () => {
    overlay = new PickerOverlay();
    overlay.attach();
    const root = overlayRootOf(document.getElementById('pageharvest-picker-overlay-host')!);
    const style = root.querySelector('style')!.textContent ?? '';

    expect(style).toContain('#10b981');
    expect(style).toContain('#a855f7');
    expect(style.match(/\.ph-similar-box/g)?.length ?? 0).toBeGreaterThan(0);
  });

  it('renders glowing corner accents inside the hover box', () => {
    document.body.innerHTML = '<div class="product-card">Card</div>';
    overlay = new PickerOverlay();
    overlay.attach();

    const card = document.querySelector('.product-card')!;
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(rectOf(100, 50, 200, 150));

    const hoverInfo: HoverElementInfo = {
      element: card,
      selector: '.product-card',
      tagName: 'div',
      classList: ['product-card'],
      rect: { top: 100, left: 50, width: 200, height: 150 },
    };
    overlay.updateHover(hoverInfo);

    const root = overlayRootOf(document.getElementById('pageharvest-picker-overlay-host')!);
    const accents = root.querySelectorAll('.ph-hover-box .ph-corner-accent');
    expect(accents.length).toBe(4);
    expect(root.querySelectorAll('.ph-hover-box .ph-corner-tl').length).toBe(1);
    expect(root.querySelectorAll('.ph-hover-box .ph-corner-tr').length).toBe(1);
    expect(root.querySelectorAll('.ph-hover-box .ph-corner-bl').length).toBe(1);
    expect(root.querySelectorAll('.ph-hover-box .ph-corner-br').length).toBe(1);
  });

  it('renders glowing corner accents inside the selection box, similar boxes unchanged', () => {
    document.body.innerHTML = `
      <section class="products">
        <article class="product-card"><h2 class="product-title">One</h2></article>
        <article class="product-card"><h2 class="product-title">Two</h2></article>
        <article class="product-card"><h2 class="product-title">Three</h2></article>
      </section>
    `;
    overlay = new PickerOverlay();
    overlay.attach();

    const first = document.querySelector('.product-card')!;
    const candidates = document.querySelectorAll('.product-card');
    vi.spyOn(first, 'getBoundingClientRect').mockReturnValue(rectOf(10, 10, 120, 40));

    const selection: SelectedElementInfo = {
      element: first,
      selector: '.product-card',
      similarSelector: '.product-card',
      tagName: 'article',
      classList: ['product-card'],
      textSnippet: 'One',
      attributes: {},
      rect: { top: 10, left: 10, width: 120, height: 40 },
      breadcrumbs: [],
      selectorCandidates: [],
      matchCount: candidates.length,
      crossFrame: { isIframe: false, isCrossOrigin: false, frameDepth: 0, isSandboxed: false },
    };
    overlay.updateSelection(selection);

    const root = overlayRootOf(document.getElementById('pageharvest-picker-overlay-host')!);
    const accents = root.querySelectorAll('.ph-selection-box .ph-corner-accent');
    expect(accents.length).toBe(4);

    // The tested similar-box contract must not change because of the neon upgrade.
    expect(root.querySelectorAll('.ph-similar-box').length).toBe(2);
  });
});

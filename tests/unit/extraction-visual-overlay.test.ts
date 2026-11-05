import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ExtractionVisualOverlay,
  EXTRACTION_OVERLAY_HOST_ID,
} from '@/content/extraction-visual-overlay';

/**
 * The extraction overlay's root is closed. To inspect what it renders, this records
 * each root as it is attached. Production exposes nothing.
 */
const attachedRoots = new WeakMap<Element, ShadowRoot>();
const originalAttachShadow = Element.prototype.attachShadow;

function overlayRootOf(host: Element): ShadowRoot {
  const root = attachedRoots.get(host);
  if (!root) throw new Error('The extraction overlay attached no shadow root.');
  return root;
}

function viewportRect(top: number, left: number): DOMRect {
  return {
    top,
    left,
    width: 120,
    height: 30,
    bottom: top + 30,
    right: left + 120,
    x: left,
    y: top,
    toJSON: () => {},
  } as DOMRect;
}

describe('ExtractionVisualOverlay (neon scan overlay)', () => {
  let overlay: ExtractionVisualOverlay;

  beforeEach(() => {
    Element.prototype.attachShadow = function attachAndRecord(this: Element, init: ShadowRootInit) {
      const root = originalAttachShadow.call(this, init);
      attachedRoots.set(this, root);
      return root;
    };
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    Element.prototype.attachShadow = originalAttachShadow;
    overlay?.destroy();
    document.body.innerHTML = '';
  });

  it('mounts a closed shadow overlay host marked as pageharvest-ignorable', () => {
    overlay = new ExtractionVisualOverlay();
    overlay.attach();

    const host = document.getElementById(EXTRACTION_OVERLAY_HOST_ID);
    expect(host).not.toBeNull();
    expect(host!.getAttribute('data-pageharvest-ignore')).toBe('true');
    expect(host!.shadowRoot).toBeNull();

    const insideViewport = document.createElement('div');
    document.body.appendChild(insideViewport);
    expect(overlay.isOverlayElement(insideViewport)).toBe(false);
    expect(overlay.isOverlayElement(host!)).toBe(true);
  });

  it('is pointer-events none beneath the picker overlay z-index order', () => {
    overlay = new ExtractionVisualOverlay();
    overlay.attach();
    overlay.start();

    const host = document.getElementById(EXTRACTION_OVERLAY_HOST_ID)!;
    const styleRoot = overlayRootOf(host);
    const styleText = styleRoot.querySelector('style')!.textContent ?? '';

    expect(styleText).toContain('pointer-events: none');
    expect(styleText).toContain('2147483646');
    expect(styleText).toContain('all: initial');
  });

  it('shows the laser bar and scanning status on start, hidden before start', () => {
    overlay = new ExtractionVisualOverlay();
    overlay.attach();

    const host = document.getElementById(EXTRACTION_OVERLAY_HOST_ID)!;
    const root = overlayRootOf(host);
    const laser = root.querySelector('.px-laser-bar')!;
    expect(laser.classList.contains('px-hidden')).toBe(true);

    overlay.start();

    expect(laser.classList.contains('px-hidden')).toBe(false);
    const hud = root.querySelector<HTMLElement>('.px-hud')!;
    expect(hud.classList.contains('px-hidden')).toBe(false);
    expect(hud.textContent).toContain('Scanning DOM');
    expect(hud.textContent).toContain('0 rows');
  });

  it('maps progress actions to HUD text', () => {
    overlay = new ExtractionVisualOverlay();
    overlay.attach();
    overlay.start();

    const host = document.getElementById(EXTRACTION_OVERLAY_HOST_ID)!;
    const hud = overlayRootOf(host).querySelector<HTMLElement>('.px-hud')!;

    overlay.setAction('scrolling');
    expect(hud.textContent).toContain('Scrolling');
    overlay.setAction('navigating');
    expect(hud.textContent).toContain('Next page');
  });

  it('pulses at most 25 visible viewport items and shows the row badge', () => {
    document.body.innerHTML = Array.from(
      { length: 40 },
      (_, i) => `<div class="card" data-i="${i}"></div>`
    ).join('');

    overlay = new ExtractionVisualOverlay();
    overlay.attach();
    overlay.start();

    const cards = Array.from(document.querySelectorAll<HTMLElement>('.card'));
    for (const card of cards) {
      vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(viewportRect(10, 10));
    }

    overlay.pulseSelector('.card', 40);

    const host = document.getElementById(EXTRACTION_OVERLAY_HOST_ID)!;
    const boxes = overlayRootOf(host).querySelectorAll('.px-scan-box');
    expect(boxes.length).toBe(25);

    const firstBadge = overlayRootOf(host).querySelector<HTMLElement>('.px-scan-badge')!;
    expect(firstBadge.textContent).toContain('✓');
    expect(firstBadge.textContent).toContain('#1');
  });

  it('skips items outside the viewport and tolerates selectors matching nothing', () => {
    document.body.innerHTML =
      '<div class="card visible"></div><div class="card hidden-el"></div>';
    overlay = new ExtractionVisualOverlay();
    overlay.attach();
    overlay.start();

    const visibleCard = document.querySelector<HTMLElement>('.card.visible')!;
    const hiddenCard = document.querySelector<HTMLElement>('.card.hidden-el')!;
    vi.spyOn(visibleCard, 'getBoundingClientRect').mockReturnValue(
      viewportRect(10, 10)
    );
    vi.spyOn(hiddenCard, 'getBoundingClientRect').mockReturnValue(
      viewportRect(5000, 5000)
    );

    overlay.pulseSelector('.card', 2);
    let boxes = overlayRootOf(
      document.getElementById(EXTRACTION_OVERLAY_HOST_ID)!
    ).querySelectorAll('.px-scan-box');
    expect(boxes.length).toBe(1);

    expect(() => overlay.pulseSelector('.does-not-exist', 3)).not.toThrow();
    boxes = overlayRootOf(
      document.getElementById(EXTRACTION_OVERLAY_HOST_ID)!
    ).querySelectorAll('.px-scan-box');
    expect(boxes.length).toBe(1);
  });

  it('cascades pulses and removes each box after its lifetime', () => {
    document.body.innerHTML =
      '<div class="card one"></div><div class="card two"></div>';
    overlay = new ExtractionVisualOverlay();
    overlay.attach();
    overlay.start({ pulseStaggerMs: 100, pulseLifeMs: 850 });

    for (const card of Array.from(document.querySelectorAll<HTMLElement>('.card'))) {
      vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(viewportRect(5, 5));
    }
    overlay.pulseSelector('.card', 2);

    const root = overlayRootOf(document.getElementById(EXTRACTION_OVERLAY_HOST_ID)!);
    expect(root.querySelectorAll('.px-scan-box').length).toBe(2);

    // Second card cascades in 100ms after the first; both live 850ms.
    vi.advanceTimersByTime(150);
    expect(root.querySelectorAll('.px-scan-box').length).toBe(2);
    vi.advanceTimersByTime(850);
    vi.advanceTimersByTime(100);
    expect(root.querySelectorAll('.px-scan-box').length).toBe(0);
  });

  it('updates the live row counter', () => {
    overlay = new ExtractionVisualOverlay();
    overlay.attach();
    overlay.start();

    overlay.addRows(12);
    const hud = overlayRootOf(
      document.getElementById(EXTRACTION_OVERLAY_HOST_ID)!
    ).querySelector<HTMLElement>('.px-hud')!;
    expect(hud.textContent).toContain('⚡');
    expect(hud.textContent).toContain('12 rows');
  });

  it('announces completion and destroys itself after the fade window', () => {
    overlay = new ExtractionVisualOverlay();
    overlay.attach();
    overlay.start({ completionFadeMs: 500 });
    overlay.complete();

    const root = overlayRootOf(
      document.getElementById(EXTRACTION_OVERLAY_HOST_ID)!
    );
    const hud = root.querySelector<HTMLElement>('.px-hud')!;
    expect(hud.textContent).toContain('✓ Harvest Complete!');

    vi.advanceTimersByTime(600);
    expect(document.getElementById(EXTRACTION_OVERLAY_HOST_ID)).toBeNull();
  });

  it('removes the host and cancels pending timers on destroy', () => {
    document.body.innerHTML = '<div class="card"></div>';
    overlay = new ExtractionVisualOverlay();
    overlay.attach();
    overlay.start();
    vi.spyOn(
      document.querySelector('.card') as HTMLElement,
      'getBoundingClientRect'
    ).mockReturnValue(viewportRect(1, 1));
    overlay.pulseSelector('.card', 1);
    overlay.destroy();

    expect(document.getElementById(EXTRACTION_OVERLAY_HOST_ID)).toBeNull();
    const timerCount = vi.getTimerCount();
    expect(timerCount).toBe(0);
  });

  it('is idempotent when started, completed, or destroyed twice', () => {
    overlay = new ExtractionVisualOverlay();
    overlay.attach();
    overlay.start();
    overlay.start();
    expect(
      document.querySelectorAll(`#${EXTRACTION_OVERLAY_HOST_ID}`)
    ).toHaveLength(1);
    overlay.complete();
    overlay.destroy();
    expect(() => overlay.destroy()).not.toThrow();
  });
});

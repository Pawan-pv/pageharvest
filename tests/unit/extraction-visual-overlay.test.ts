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
    expect(hud.textContent).toContain('Reading the page');
    expect(hud.textContent).toContain('0 rows');
  });

  it('maps progress actions to HUD text', () => {
    overlay = new ExtractionVisualOverlay();
    overlay.attach();
    overlay.start();

    const host = document.getElementById(EXTRACTION_OVERLAY_HOST_ID)!;
    const hud = overlayRootOf(host).querySelector<HTMLElement>('.px-hud')!;

    overlay.setAction('scrolling');
    expect(hud.textContent).toContain('Scrolling for more');
    overlay.setAction('navigating');
    expect(hud.textContent).toContain('Opening the next page');
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
    expect(hud.querySelector('.px-action')!.textContent).toBe('Harvest complete');
    // Finished: the counter no longer says it is still harvesting.
    expect(hud.querySelector('.px-counter')!.textContent).toBe('0 rows saved');
    expect(hud.textContent).not.toContain('Harvesting');

    vi.advanceTimersByTime(600);
    expect(document.getElementById(EXTRACTION_OVERLAY_HOST_ID)).toBeNull();
  });

  it('fades the host out at the end of the completion window before removing it', () => {
    overlay = new ExtractionVisualOverlay();
    overlay.attach();
    overlay.start({ completionFadeMs: 2500 });
    overlay.complete();

    const host = document.getElementById(EXTRACTION_OVERLAY_HOST_ID)!;
    vi.advanceTimersByTime(2000);
    expect(host.style.opacity).not.toBe('0');

    vi.advanceTimersByTime(150);
    expect(host.style.opacity).toBe('0');
    expect(host.isConnected).toBe(true);

    vi.advanceTimersByTime(400);
    expect(host.isConnected).toBe(false);
  });

  it('a new run started during the completion window is not torn down by the old one', () => {
    overlay = new ExtractionVisualOverlay();
    overlay.attach();
    overlay.start({ completionFadeMs: 2500 });
    overlay.complete();
    vi.advanceTimersByTime(2200);

    overlay.start();

    const host = document.getElementById(EXTRACTION_OVERLAY_HOST_ID)!;
    expect(host.style.opacity).not.toBe('0');

    vi.advanceTimersByTime(5000);
    expect(host.isConnected).toBe(true);
    const hud = overlayRootOf(host).querySelector<HTMLElement>('.px-hud')!;
    expect(hud.textContent).toContain('0 rows');
    expect(hud.textContent).toContain('Reading the page');
  });

  it('starts the counter from rows an earlier document already harvested', () => {
    overlay = new ExtractionVisualOverlay();
    overlay.start({}, 7);

    const hud = overlayRootOf(document.getElementById(EXTRACTION_OVERLAY_HOST_ID)!).querySelector<HTMLElement>('.px-hud')!;
    expect(hud.textContent).toContain('7 rows');
    overlay.addRows(3);
    expect(hud.textContent).toContain('10 rows');
  });

  it('keeps each pulse box on its item while the page or a container scrolls', () => {
    document.body.innerHTML = '<div class="card"></div>';
    const card = document.querySelector<HTMLElement>('.card')!;
    const rect = vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(viewportRect(100, 50));

    overlay = new ExtractionVisualOverlay();
    overlay.start();
    overlay.pulseSelector('.card', 1);

    const box = overlayRootOf(document.getElementById(EXTRACTION_OVERLAY_HOST_ID)!).querySelector<HTMLElement>('.px-scan-box')!;
    expect(box.style.top).toBe('100px');

    rect.mockReturnValue(viewportRect(40, 50));
    document.body.dispatchEvent(new Event('scroll'));
    expect(box.style.top).toBe('40px');
  });

  it('stops the laser bar on completion while the HUD stays up', () => {
    overlay = new ExtractionVisualOverlay();
    overlay.attach();
    overlay.start();

    const root = overlayRootOf(document.getElementById(EXTRACTION_OVERLAY_HOST_ID)!);
    overlay.complete();

    expect(root.querySelector('.px-laser-bar')!.classList.contains('px-hidden')).toBe(true);
    expect(root.querySelector('.px-hud')!.classList.contains('px-hidden')).toBe(false);
  });

  it('draws the laser bar as a cyan-to-emerald gradient only', () => {
    overlay = new ExtractionVisualOverlay();
    overlay.attach();

    const host = document.getElementById(EXTRACTION_OVERLAY_HOST_ID)!;
    const styleText = overlayRootOf(host).querySelector('style')!.textContent ?? '';
    const laserRule = /\.px-laser-bar \{[^}]*\}/.exec(styleText)?.[0] ?? '';

    expect(laserRule).toContain('#00f5d4');
    expect(laserRule).toContain('#10b981');
    expect(laserRule).not.toContain('#a855f7');
  });

  it('sweeps a scan beam and an edge glow while running, and stops both at completion', () => {
    overlay = new ExtractionVisualOverlay();
    overlay.attach();
    const root = overlayRootOf(document.getElementById(EXTRACTION_OVERLAY_HOST_ID)!);
    const beam = root.querySelector('.px-beam')!;
    const frame = root.querySelector('.px-frame')!;
    expect(beam.classList.contains('px-hidden')).toBe(true);
    expect(frame.classList.contains('px-hidden')).toBe(true);

    overlay.start();
    expect(beam.classList.contains('px-hidden')).toBe(false);
    expect(frame.classList.contains('px-hidden')).toBe(false);

    overlay.setAction('navigating');
    expect(root.querySelector<HTMLElement>('.px-root')!.dataset.action).toBe('navigating');

    overlay.complete();
    expect(beam.classList.contains('px-hidden')).toBe(true);
    expect(frame.classList.contains('px-frame-done')).toBe(true);
    expect(root.querySelector('.px-hud')!.classList.contains('px-done')).toBe(true);
  });

  it('sends one spark per pulsed item toward the HUD and removes it after its flight', () => {
    document.body.innerHTML = '<div class="card one"></div><div class="card two"></div>';
    overlay = new ExtractionVisualOverlay();
    overlay.start({ pulseStaggerMs: 100, pulseLifeMs: 850 });
    for (const card of Array.from(document.querySelectorAll<HTMLElement>('.card'))) {
      vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(viewportRect(200, 40));
    }
    const root = overlayRootOf(document.getElementById(EXTRACTION_OVERLAY_HOST_ID)!);
    vi.spyOn(root.querySelector<HTMLElement>('.px-orb')!, 'getBoundingClientRect').mockReturnValue(
      { ...viewportRect(600, 900), width: 10, height: 10 } as DOMRect
    );

    overlay.pulseSelector('.card', 2);

    const sparks = Array.from(root.querySelectorAll<HTMLElement>('.px-spark'));
    expect(sparks).toHaveLength(2);
    // Starts at the item's centre and flies to the orb's centre.
    expect(sparks[0].style.left).toBe('100px');
    expect(sparks[0].style.top).toBe('215px');
    expect(sparks[0].style.getPropertyValue('--px-dx')).toBe('805px');
    expect(sparks[0].style.getPropertyValue('--px-dy')).toBe('390px');

    vi.advanceTimersByTime(2000);
    expect(root.querySelectorAll('.px-spark')).toHaveLength(0);
  });

  it('bumps the counter each time rows land', () => {
    overlay = new ExtractionVisualOverlay();
    overlay.start();
    const counter = overlayRootOf(document.getElementById(EXTRACTION_OVERLAY_HOST_ID)!).querySelector<HTMLElement>(
      '.px-counter'
    )!;
    expect(counter.classList.contains('px-bump')).toBe(false);
    overlay.addRows(4);
    expect(counter.classList.contains('px-bump')).toBe(true);
    overlay.addRows(0);
    expect(counter.textContent).toBe('⚡ Harvesting • 4 rows');
    overlay.addRows(-3);
    expect(counter.textContent).toBe('⚡ Harvesting • 1 row');
  });

  it('bursts on completion, and a new run clears the finished state', () => {
    overlay = new ExtractionVisualOverlay();
    overlay.start({ completionFadeMs: 2500 });
    overlay.addRows(20);
    overlay.complete();
    const root = overlayRootOf(document.getElementById(EXTRACTION_OVERLAY_HOST_ID)!);
    expect(root.querySelectorAll('.px-burst').length).toBeGreaterThan(0);
    expect(root.querySelector('.px-counter')!.textContent).toBe('20 rows saved');

    vi.advanceTimersByTime(1000);
    expect(root.querySelectorAll('.px-burst')).toHaveLength(0);

    overlay.start();
    expect(root.querySelector('.px-hud')!.classList.contains('px-done')).toBe(false);
    expect(root.querySelector('.px-frame')!.classList.contains('px-frame-done')).toBe(false);
    expect(root.querySelector('.px-beam')!.classList.contains('px-hidden')).toBe(false);
    expect(root.querySelector('.px-counter')!.textContent).toBe('⚡ Harvesting • 0 rows');
  });

  it('hides the moving beam and sparks for people who prefer reduced motion', () => {
    overlay = new ExtractionVisualOverlay();
    overlay.attach();
    const css = overlayRootOf(document.getElementById(EXTRACTION_OVERLAY_HOST_ID)!).querySelector('style')!.textContent ?? '';
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toMatch(/\.px-beam[^{]*\.px-spark[^{]*\.px-burst[^{]*\{[^}]*display:\s*none\s*!important/);
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

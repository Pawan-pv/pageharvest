/**
 * Active Scraping Neon Scan Overlay.
 *
 * Mounts a `pointer-events: none` closed Shadow DOM host on the page while an
 * extraction run is active. It draws:
 *  - a glowing rail along the top with a travelling highlight, a soft scan beam that
 *    sweeps down the viewport and a breathing glow around the viewport edge;
 *  - for each committed batch, cascading lock-on boxes over the harvested items
 *    (corner brackets, one light sweep, a `✓ #n` badge) and a spark that flies from
 *    each item into the HUD;
 *  - a HUD card with a spinning ring, the current step, the live row count and an
 *    activity bar, which turns green and bursts when the run completes.
 * Everything animates transform and opacity only. The host is marked with
 * `data-pageharvest-ignore` so the navigation observers ignore its mutations, and
 * reduced-motion users get the same information with no movement.
 */

import { isPageHarvestOverlayNode } from '@/utils/dom';

export const EXTRACTION_OVERLAY_HOST_ID = 'pageharvest-extraction-overlay-host';

/** Actions the HUD can announce. */
export type ExtractionOverlayAction = 'scanning' | 'scrolling' | 'navigating' | 'complete';

export interface ExtractionOverlayTimingOptions {
  /** Delay before the overlay unmounts after the run completes. */
  completionFadeMs?: number;
  /** Delay between the cascade of item pulse boxes. */
  pulseStaggerMs?: number;
  /** How long one item pulse box lives. */
  pulseLifeMs?: number;
  /** Hard cap of simultaneously visible pulse boxes (perf guard). */
  maxVisibleItems?: number;
}

export type ExtractionOverlayTiming = Required<ExtractionOverlayTimingOptions>;

const PRODUCTION_DEFAULTS: ExtractionOverlayTiming = {
  completionFadeMs: 2500,
  pulseStaggerMs: 40,
  pulseLifeMs: 850,
  maxVisibleItems: 25,
};

/** Current timing defaults; shorter values can be injected for tests. */
export const EXTRACTION_OVERLAY_DEFAULTS: ExtractionOverlayTiming = { ...PRODUCTION_DEFAULTS };

const ACTION_LABELS: Record<ExtractionOverlayAction, string> = {
  scanning: 'Reading the page…',
  scrolling: 'Scrolling for more…',
  navigating: 'Opening the next page…',
  complete: 'Harvest complete',
};

/** The host's final fade; it ends exactly when the completion window does. */
const HOST_FADE_OUT_MS = 400;
/** A spark leaves its item once the lock-on has landed. */
const SPARK_LEAD_MS = 220;
const SPARK_FLIGHT_MS = 720;
const BURST_COUNT = 12;
const BURST_LIFE_MS = 900;

interface OverlayInternals {
  root: HTMLElement | null;
  frame: HTMLElement | null;
  laserBar: HTMLElement | null;
  beam: HTMLElement | null;
  hud: HTMLElement | null;
  orb: HTMLElement | null;
  counter: HTMLElement | null;
  actionLabel: HTMLElement | null;
  scanLayer: HTMLElement | null;
  style: HTMLStyleElement | null;
}

const EMPTY_INTERNALS: OverlayInternals = {
  root: null,
  frame: null,
  laserBar: null,
  beam: null,
  hud: null,
  orb: null,
  counter: null,
  actionLabel: null,
  scanLayer: null,
  style: null,
};

const OVERLAY_STYLES = `
  :host {
    all: initial;
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    z-index: 2147483646;
    pointer-events: none;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 13px;
    line-height: 1.4;
    box-sizing: border-box;
    opacity: 1;
    transition: opacity ${HOST_FADE_OUT_MS}ms ease-out;
  }

  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  .px-hidden {
    display: none !important;
  }

  .px-root {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }

  /* ---- Ambient: edge glow, top rail, scan beam ---------------------------- */

  .px-frame {
    position: absolute;
    inset: 0;
    box-shadow: inset 0 0 0 1px rgba(0, 245, 212, 0.3), inset 0 0 56px rgba(0, 245, 212, 0.16);
    animation: px-breathe 2.6s ease-in-out infinite;
  }

  @keyframes px-breathe {
    0%, 100% { opacity: 0.55; }
    50% { opacity: 1; }
  }

  .px-frame.px-frame-done {
    box-shadow: inset 0 0 0 2px rgba(16, 185, 129, 0.6), inset 0 0 90px rgba(16, 185, 129, 0.3);
    animation: px-flash 1.1s ease-out both;
  }

  @keyframes px-flash {
    0% { opacity: 0; }
    25% { opacity: 1; }
    100% { opacity: 0.45; }
  }

  .px-laser-bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: linear-gradient(90deg, #00f5d4 0%, #10b981 50%, #00f5d4 100%);
    background-size: 200% 100%;
    box-shadow: 0 0 12px rgba(0, 245, 212, 0.8), 0 0 28px rgba(16, 185, 129, 0.55);
    animation: px-laser-slide 2.2s linear infinite;
    overflow: visible;
  }

  /* A bright comet travelling along the rail. */
  .px-laser-bar::after {
    content: '';
    position: absolute;
    top: -3px;
    left: 0;
    width: 160px;
    height: 9px;
    border-radius: 999px;
    background: radial-gradient(ellipse at center, rgba(255, 255, 255, 0.95) 0%, rgba(0, 245, 212, 0.65) 35%, rgba(0, 245, 212, 0) 70%);
    animation: px-comet 1.8s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite;
    will-change: transform;
  }

  @keyframes px-laser-slide {
    0% { background-position: 0% 50%; }
    100% { background-position: 200% 50%; }
  }

  @keyframes px-comet {
    from { transform: translateX(-160px); }
    to { transform: translateX(100vw); }
  }

  .px-beam {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 160px;
    background: linear-gradient(
      180deg,
      rgba(0, 245, 212, 0) 0%,
      rgba(0, 245, 212, 0.05) 55%,
      rgba(0, 245, 212, 0.16) 94%,
      rgba(0, 245, 212, 0) 100%
    );
    animation: px-beam 3.4s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite;
    will-change: transform;
  }

  /* The beam's leading edge. */
  .px-beam::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 8px;
    height: 2px;
    background: linear-gradient(90deg, rgba(0, 245, 212, 0) 0%, rgba(0, 245, 212, 0.9) 20%, rgba(16, 185, 129, 0.9) 80%, rgba(16, 185, 129, 0) 100%);
    box-shadow: 0 0 14px rgba(0, 245, 212, 0.75);
  }

  @keyframes px-beam {
    from { transform: translateY(-170px); }
    to { transform: translateY(100vh); }
  }

  .px-root[data-action="scrolling"] .px-beam { animation-duration: 2.4s; }
  .px-root[data-action="navigating"] .px-beam { animation-duration: 1.2s; }

  /* ---- Items: lock-on box, light sweep, badge, spark ---------------------- */

  .px-scan-box {
    position: absolute;
    border: 2px solid #00f5d4;
    /* Dark ring: keeps the neon outline visible (3:1) on light pages too. */
    outline: 1px solid rgba(2, 6, 23, 0.85);
    outline-offset: 0;
    border-radius: 6px;
    box-shadow: 0 0 14px rgba(0, 245, 212, 0.6), inset 0 0 10px rgba(0, 245, 212, 0.2);
    background: rgba(0, 245, 212, 0.07);
    overflow: visible;
    animation: px-box-in 460ms cubic-bezier(0.2, 0.8, 0.2, 1) var(--px-delay, 0ms) both;
  }

  /* Opacity is set only in the first keyframe, so the fade-out on the box still works. */
  @keyframes px-box-in {
    0% {
      opacity: 0;
      transform: scale(1.06);
      box-shadow: 0 0 0 6px rgba(0, 245, 212, 0.35), 0 0 36px rgba(0, 245, 212, 0.9), inset 0 0 22px rgba(0, 245, 212, 0.45);
    }
    60% { transform: scale(0.99); }
    100% { transform: scale(1); }
  }

  /* Corner brackets that close in on the item. */
  .px-scan-box::before {
    content: '';
    position: absolute;
    inset: -7px;
    border-radius: 9px;
    --px-c: #00f5d4;
    background:
      linear-gradient(var(--px-c), var(--px-c)) top left / 16px 3px no-repeat,
      linear-gradient(var(--px-c), var(--px-c)) top left / 3px 16px no-repeat,
      linear-gradient(var(--px-c), var(--px-c)) top right / 16px 3px no-repeat,
      linear-gradient(var(--px-c), var(--px-c)) top right / 3px 16px no-repeat,
      linear-gradient(var(--px-c), var(--px-c)) bottom left / 16px 3px no-repeat,
      linear-gradient(var(--px-c), var(--px-c)) bottom left / 3px 16px no-repeat,
      linear-gradient(var(--px-c), var(--px-c)) bottom right / 16px 3px no-repeat,
      linear-gradient(var(--px-c), var(--px-c)) bottom right / 3px 16px no-repeat;
    filter: drop-shadow(0 0 4px rgba(0, 245, 212, 0.9)) drop-shadow(0 0 1px rgba(2, 6, 23, 0.9));
    animation: px-lock 380ms cubic-bezier(0.2, 0.9, 0.3, 1) var(--px-delay, 0ms) both;
  }

  @keyframes px-lock {
    from { opacity: 0; transform: scale(1.14); }
    to { opacity: 1; transform: scale(1); }
  }

  /* One pass of light across the item. */
  .px-scan-box::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 35%;
    border-radius: 4px;
    background: linear-gradient(90deg, rgba(0, 245, 212, 0), rgba(0, 245, 212, 0.45), rgba(255, 255, 255, 0.35), rgba(0, 245, 212, 0));
    animation: px-scan-sweep 620ms ease-out calc(var(--px-delay, 0ms) + 120ms) 1 both;
  }

  @keyframes px-scan-sweep {
    from { opacity: 1; transform: translateX(-100%); }
    to { opacity: 0; transform: translateX(290%); }
  }

  .px-scan-badge {
    position: absolute;
    top: -11px;
    right: -6px;
    padding: 1px 7px;
    border-radius: 999px;
    background: rgba(10, 15, 28, 0.92);
    border: 1px solid rgba(0, 245, 212, 0.85);
    color: #00f5d4;
    font-size: 10px;
    font-weight: 700;
    line-height: 15px;
    letter-spacing: 0.02em;
    white-space: nowrap;
    text-shadow: 0 0 6px rgba(0, 245, 212, 0.9);
    box-shadow: 0 0 10px rgba(0, 245, 212, 0.45);
    animation: px-badge-in 320ms cubic-bezier(0.3, 1.6, 0.5, 1) calc(var(--px-delay, 0ms) + 160ms) both;
  }

  @keyframes px-badge-in {
    from { opacity: 0; transform: translateY(4px) scale(0.6); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  /* Horizontal and vertical motion on separate elements make the flight an arc. */
  .px-spark {
    position: absolute;
    width: 0;
    height: 0;
    animation: px-fly-x ${SPARK_FLIGHT_MS}ms cubic-bezier(0.4, 0, 0.6, 1) var(--px-delay, 0ms) both;
  }

  .px-spark-core {
    position: absolute;
    left: -7px;
    top: -7px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: radial-gradient(circle, #ffffff 0 24%, #00f5d4 52%, rgba(0, 245, 212, 0) 72%);
    box-shadow: 0 0 12px rgba(0, 245, 212, 1), 0 0 26px rgba(16, 185, 129, 0.75);
    animation: px-fly-y ${SPARK_FLIGHT_MS}ms cubic-bezier(0.55, -0.5, 0.75, 1) var(--px-delay, 0ms) both;
  }

  @keyframes px-fly-x {
    from { transform: translateX(0); }
    to { transform: translateX(var(--px-dx, 0px)); }
  }

  @keyframes px-fly-y {
    0% { opacity: 0; transform: translateY(0) scale(0.5); }
    12% { opacity: 1; transform: translateY(0) scale(1.35); }
    85% { opacity: 1; }
    100% { opacity: 0; transform: translateY(var(--px-dy, 0px)) scale(0.45); }
  }

  .px-burst {
    position: absolute;
    left: -4px;
    top: -4px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #34d399;
    box-shadow: 0 0 8px rgba(52, 211, 153, 0.95);
    animation: px-burst ${BURST_LIFE_MS - 60}ms cubic-bezier(0.1, 0.8, 0.3, 1) both;
  }

  .px-burst:nth-child(3n) { background: #00f5d4; box-shadow: 0 0 8px rgba(0, 245, 212, 0.95); }
  .px-burst:nth-child(4n) { background: #ffffff; }

  @keyframes px-burst {
    0% { opacity: 1; transform: translate(0, 0) scale(1.2); }
    100% { opacity: 0; transform: translate(var(--px-dx, 0px), var(--px-dy, 0px)) scale(0.3); }
  }

  /* ---- HUD ---------------------------------------------------------------- */

  .px-hud {
    position: absolute;
    right: 18px;
    bottom: 18px;
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 210px;
    padding: 10px 18px 12px 12px;
    border-radius: 16px;
    background: rgba(10, 15, 28, 0.92);
    border: 1px solid rgba(0, 245, 212, 0.5);
    box-shadow: 0 0 0 1px rgba(0, 245, 212, 0.12), 0 0 24px rgba(0, 245, 212, 0.3), 0 12px 32px rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(10px) saturate(140%);
    color: #dbe7ff;
    font-size: 12px;
    font-weight: 500;
    line-height: 16px;
    white-space: nowrap;
    overflow: hidden;
    animation: px-hud-in 460ms cubic-bezier(0.2, 0.9, 0.3, 1.15) both;
    transition: border-color 300ms ease, box-shadow 300ms ease;
  }

  @keyframes px-hud-in {
    from { opacity: 0; transform: translateY(18px) scale(0.94); }
  }

  .px-orb {
    position: relative;
    width: 26px;
    height: 26px;
    flex: none;
    border-radius: 50%;
  }

  /* Spinning ring. */
  .px-orb::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: conic-gradient(from 0deg, rgba(0, 245, 212, 0) 0deg, #00f5d4 250deg, #10b981 360deg);
    -webkit-mask: radial-gradient(circle, transparent 9px, #000 10px);
    mask: radial-gradient(circle, transparent 9px, #000 10px);
    animation: px-spin 1s linear infinite;
  }

  .px-orb-core {
    position: absolute;
    inset: 8px;
    border-radius: 50%;
    background: #00f5d4;
    box-shadow: 0 0 8px rgba(0, 245, 212, 0.9), 0 0 14px rgba(16, 185, 129, 0.65);
    animation: px-orb-pulse 1s ease-in-out infinite;
  }

  @keyframes px-spin {
    to { transform: rotate(360deg); }
  }

  @keyframes px-orb-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.6; transform: scale(0.75); }
  }

  .px-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .px-action {
    color: #9fc4e8;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .px-counter {
    display: inline-block;
    color: #00f5d4;
    font-size: 15px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    text-shadow: 0 0 8px rgba(0, 245, 212, 0.6);
    transform-origin: left center;
  }

  .px-counter.px-bump {
    animation: px-bump 360ms cubic-bezier(0.3, 1.6, 0.5, 1);
  }

  @keyframes px-bump {
    0% { transform: scale(1); }
    40% { transform: scale(1.14); text-shadow: 0 0 16px rgba(0, 245, 212, 1); }
    100% { transform: scale(1); }
  }

  .px-track {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 2px;
    overflow: hidden;
    background: rgba(0, 245, 212, 0.12);
  }

  .px-track::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 40%;
    background: linear-gradient(90deg, rgba(0, 245, 212, 0), #00f5d4, #10b981, rgba(16, 185, 129, 0));
    animation: px-track 1.4s ease-in-out infinite;
  }

  @keyframes px-track {
    from { transform: translateX(-100%); }
    to { transform: translateX(250%); }
  }

  /* Finished: green card, a checkmark in the ring, one ripple. */
  .px-hud.px-done {
    border-color: rgba(52, 211, 153, 0.85);
    box-shadow: 0 0 0 1px rgba(52, 211, 153, 0.3), 0 0 30px rgba(16, 185, 129, 0.5), 0 12px 32px rgba(0, 0, 0, 0.5);
  }

  .px-hud.px-done .px-orb::before {
    background: #10b981;
    animation: none;
  }

  .px-hud.px-done .px-orb {
    animation: px-ripple 900ms ease-out 1 both;
  }

  .px-hud.px-done .px-orb-core {
    inset: 3px;
    background: #10b981;
    animation: px-check-in 420ms cubic-bezier(0.3, 1.6, 0.5, 1) both;
  }

  .px-hud.px-done .px-orb-core::after {
    content: '✓';
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #022c22;
    font-size: 13px;
    font-weight: 800;
  }

  .px-hud.px-done .px-counter {
    color: #34d399;
    text-shadow: 0 0 8px rgba(52, 211, 153, 0.55);
  }

  .px-hud.px-done .px-track::after {
    width: 100%;
    background: #34d399;
    animation: none;
  }

  @keyframes px-check-in {
    from { transform: scale(0.2) rotate(-30deg); }
    to { transform: scale(1) rotate(0); }
  }

  @keyframes px-ripple {
    0% { box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.7); }
    100% { box-shadow: 0 0 0 18px rgba(52, 211, 153, 0); }
  }

  /* Same information, no movement, for people who prefer reduced motion. */
  @media (prefers-reduced-motion: reduce) {
    :host, *, *::before, *::after {
      animation: none !important;
      transition: none !important;
    }
    .px-beam, .px-spark, .px-burst, .px-laser-bar::after { display: none !important; }
  }
`;

function centerOf(rect: DOMRect): { x: number; y: number } {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function rowsLabel(count: number): string {
  return `${count} ${count === 1 ? 'row' : 'rows'}`;
}

function px(value: number): string {
  return `${Math.round(value)}px`;
}

export class ExtractionVisualOverlay {
  private hostElement: HTMLElement | null = null;
  private internals: OverlayInternals = { ...EMPTY_INTERNALS };

  private timing: ExtractionOverlayTiming = { ...EXTRACTION_OVERLAY_DEFAULTS };
  private rows = 0;
  private started = false;
  private pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  /** Live pulse boxes and the page element each one marks. */
  private trackedBoxes = new Map<HTMLElement, Element>();

  /**
   * Keeps pulse boxes on their items while the run scrolls the page or a container.
   * Capture phase sees every scroll; browsers fire scroll at most once per frame.
   */
  private readonly onScroll = (): void => {
    for (const [box, element] of this.trackedBoxes) {
      const rect = element.getBoundingClientRect();
      box.style.top = `${rect.top}px`;
      box.style.left = `${rect.left}px`;
    }
  };

  /** Initializes and injects the isolated host into the document, keeping everything hidden. */
  public attach(): void {
    this.ensureAttached();
  }

  /** Shows the rail, beam, edge glow and HUD; the counter starts from rows already harvested. */
  public start(options: ExtractionOverlayTimingOptions = {}, initialRows = 0): void {
    this.timing = { ...this.timing, ...options };
    this.ensureAttached();

    // A previous run's completion fade, leftover pulses or burst must not touch this run.
    for (const timer of this.pendingTimers) clearTimeout(timer);
    this.pendingTimers.clear();
    this.internals.scanLayer?.replaceChildren();
    if (this.hostElement) this.hostElement.style.opacity = '';
    this.trackedBoxes.clear();
    document.addEventListener('scroll', this.onScroll, { capture: true, passive: true });

    const { laserBar, beam, frame, hud } = this.internals;
    hud?.classList.remove('px-done');
    frame?.classList.remove('px-frame-done');

    this.rows = Math.max(0, initialRows);
    this.renderCount();
    this.setAction('scanning');

    for (const element of [laserBar, beam, frame, hud]) element?.classList.remove('px-hidden');
    this.started = true;
  }

  /** Announces the run completion, celebrates it, and schedules the overlay's self-removal. */
  public complete(): void {
    if (!this.started) return;
    this.setAction('complete');
    const { laserBar, beam, frame, hud, counter } = this.internals;
    laserBar?.classList.add('px-hidden');
    beam?.classList.add('px-hidden');
    frame?.classList.add('px-frame-done');
    hud?.classList.add('px-done');
    // The ring shows the check mark; the text says what was kept.
    if (counter) counter.textContent = `${rowsLabel(this.rows)} saved`;
    this.spawnBurst();

    this.schedule(Math.max(0, this.timing.completionFadeMs - HOST_FADE_OUT_MS), () => {
      if (this.hostElement) this.hostElement.style.opacity = '0';
    });
    this.schedule(this.timing.completionFadeMs, () => this.destroy());
  }

  /** Updates the HUD step text; the beam speeds up for scrolling and page changes. */
  public setAction(action: ExtractionOverlayAction): void {
    if (this.internals.actionLabel) {
      this.internals.actionLabel.textContent = ACTION_LABELS[action];
    }
    if (this.internals.root) this.internals.root.dataset.action = action;
  }

  /** Adds harvested rows to the live counter, which bumps when rows land. */
  public addRows(count: number): void {
    this.rows += count;
    this.renderCount();
    const counter = this.internals.counter;
    if (counter && count > 0) {
      // Restart the bump: drop the class, force a style flush, add it back.
      counter.classList.remove('px-bump');
      void counter.offsetWidth;
      counter.classList.add('px-bump');
    }
  }

  /**
   * Locks glowing boxes onto up to `maxVisibleItems` visible items matching the
   * container selector, each sending a spark into the HUD. Off-screen and zero-sized
   * elements are skipped.
   */
  public pulseSelector(selector: string, count?: number): void {
    if (!this.started || !this.internals.scanLayer) return;

    let selected: Array<{ element: Element; rect: DOMRect }>;
    try {
      const matches = Array.from(document.querySelectorAll(selector));
      const width = typeof window !== 'undefined' ? window.innerWidth : 0;
      const height = typeof window !== 'undefined' ? window.innerHeight : 0;
      selected = matches
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
        .filter(
          ({ rect }) =>
            rect.width > 0 &&
            rect.height > 0 &&
            rect.top < height &&
            rect.bottom > 0 &&
            rect.left < width &&
            rect.right > 0
        )
        .slice(0, Math.max(0, count ?? matches.length));
    } catch {
      // An unusable selector never breaks a run; it simply shows nothing.
      return;
    }

    const visible = selected.slice(0, this.timing.maxVisibleItems);
    if (visible.length === 0) return;
    const target = this.hudTarget();
    visible.forEach((entry, index) => {
      const delayMs = this.timing.pulseStaggerMs * index;
      this.spawnPulseBox(entry.element, entry.rect, index + 1, delayMs);
      this.spawnSpark(entry.rect, target, delayMs + SPARK_LEAD_MS);
    });
  }

  /** Replaces the instance timing (used by the shared-options hook). */
  public setTiming(timing: ExtractionOverlayTiming): void {
    this.timing = { ...timing };
  }

  /** True when the node belongs to a PageHarvest overlay host. */
  public isOverlayElement(node: Node): boolean {
    return isPageHarvestOverlayNode(node);
  }

  /** Removes the host and clears every pending timer. */
  public destroy(): void {
    for (const timer of this.pendingTimers) clearTimeout(timer);
    this.pendingTimers.clear();
    this.trackedBoxes.clear();
    if (typeof document !== 'undefined') {
      document.removeEventListener('scroll', this.onScroll, { capture: true });
    }
    this.hostElement?.remove();
    this.hostElement = null;
    this.internals = { ...EMPTY_INTERNALS };
    this.started = false;
  }

  // ---------------------------------------------------------------------------

  private renderCount(): void {
    if (this.internals.counter) {
      this.internals.counter.textContent = `⚡ Harvesting • ${rowsLabel(this.rows)}`;
    }
  }

  /** Where sparks land: the HUD ring's centre (the card's, if the ring has no box). */
  private hudTarget(): { x: number; y: number } {
    const orbRect = this.internals.orb?.getBoundingClientRect();
    if (orbRect && (orbRect.width > 0 || orbRect.height > 0)) return centerOf(orbRect);
    const hudRect = this.internals.hud?.getBoundingClientRect();
    return hudRect ? centerOf(hudRect) : { x: 0, y: 0 };
  }

  private ensureAttached(): void {
    if (this.hostElement?.isConnected) return;
    this.destroy();
    if (typeof document === 'undefined') return;

    document.getElementById(EXTRACTION_OVERLAY_HOST_ID)?.remove();
    const host = document.createElement('div');
    host.id = EXTRACTION_OVERLAY_HOST_ID;
    host.setAttribute('data-pageharvest-ignore', 'true');
    (document.body || document.documentElement).appendChild(host);
    this.hostElement = host;

    const shadowRoot = host.attachShadow({ mode: 'closed' });
    const styleEl = document.createElement('style');
    styleEl.textContent = OVERLAY_STYLES;
    shadowRoot.appendChild(styleEl);

    const make = (tag: string, className: string): HTMLElement => {
      const element = document.createElement(tag);
      element.className = className;
      return element;
    };

    const root = make('div', 'px-root');
    const frame = make('div', 'px-frame px-hidden');
    const laserBar = make('div', 'px-laser-bar px-hidden');
    const beam = make('div', 'px-beam px-hidden');
    const scanLayer = make('div', 'px-scan-layer');

    const hud = make('div', 'px-hud px-hidden');
    const orb = make('span', 'px-orb');
    orb.appendChild(make('span', 'px-orb-core'));
    const text = make('span', 'px-text');
    const actionLabel = make('span', 'px-action');
    actionLabel.textContent = ACTION_LABELS.scanning;
    const counter = make('span', 'px-counter');
    counter.textContent = '⚡ Harvesting • 0 rows';
    text.append(actionLabel, counter);
    hud.append(orb, text, make('span', 'px-track'));

    root.append(frame, beam, laserBar, scanLayer, hud);
    shadowRoot.appendChild(root);

    this.internals = {
      root,
      frame,
      laserBar,
      beam,
      hud,
      orb,
      counter,
      actionLabel,
      scanLayer,
      style: styleEl,
    };
  }

  private spawnPulseBox(element: Element, rect: DOMRect, index: number, delayMs: number): void {
    const layer = this.internals.scanLayer;
    if (!layer) return;

    const box = document.createElement('div');
    box.className = 'px-scan-box';
    box.style.top = `${rect.top}px`;
    box.style.left = `${rect.left}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
    // Cascade: the lock-on, sweep and badge start after `delayMs`; until then the
    // backwards keyframe fill keeps the box invisible.
    box.style.setProperty('--px-delay', `${delayMs}ms`);

    const badge = document.createElement('span');
    badge.className = 'px-scan-badge';
    badge.textContent = `✓ #${index}`;
    box.appendChild(badge);

    layer.appendChild(box);
    this.trackedBoxes.set(box, element);

    const lifeMs = this.timing.pulseLifeMs;
    const fadeMs = Math.min(260, Math.max(60, Math.floor(lifeMs / 3)));
    this.schedule(delayMs + lifeMs - fadeMs, () => {
      box.style.transition = `opacity ${fadeMs}ms ease`;
      box.style.opacity = '0';
    });
    this.schedule(delayMs + lifeMs, () => {
      this.trackedBoxes.delete(box);
      box.remove();
    });
  }

  /** A spark that arcs from an item's centre into the HUD ring. */
  private spawnSpark(rect: DOMRect, target: { x: number; y: number }, delayMs: number): void {
    const layer = this.internals.scanLayer;
    if (!layer) return;
    const from = centerOf(rect);
    const spark = document.createElement('div');
    spark.className = 'px-spark';
    spark.style.left = px(from.x);
    spark.style.top = px(from.y);
    spark.style.setProperty('--px-dx', px(target.x - from.x));
    spark.style.setProperty('--px-dy', px(target.y - from.y));
    spark.style.setProperty('--px-delay', `${delayMs}ms`);
    const core = document.createElement('span');
    core.className = 'px-spark-core';
    spark.appendChild(core);
    layer.appendChild(spark);
    this.schedule(delayMs + SPARK_FLIGHT_MS + 40, () => spark.remove());
  }

  /** Completion: particles burst out of the HUD ring. */
  private spawnBurst(): void {
    const layer = this.internals.scanLayer;
    if (!layer) return;
    const origin = this.hudTarget();
    const particles: HTMLElement[] = [];
    for (let i = 0; i < BURST_COUNT; i += 1) {
      const angle = (Math.PI * 2 * i) / BURST_COUNT;
      const distance = 56 + (i % 3) * 22;
      const holder = document.createElement('div');
      holder.style.position = 'absolute';
      holder.style.left = px(origin.x);
      holder.style.top = px(origin.y);
      const particle = document.createElement('span');
      particle.className = 'px-burst';
      particle.style.setProperty('--px-dx', px(Math.cos(angle) * distance));
      particle.style.setProperty('--px-dy', px(Math.sin(angle) * distance));
      holder.appendChild(particle);
      layer.appendChild(holder);
      particles.push(holder);
    }
    this.schedule(BURST_LIFE_MS, () => {
      for (const particle of particles) particle.remove();
    });
  }

  private schedule(delayMs: number, callback: () => void): void {
    const timer = setTimeout(() => {
      this.pendingTimers.delete(timer);
      callback();
    }, delayMs);
    this.pendingTimers.add(timer);
  }
}

// ---------------------------------------------------------------------------
// Shared singleton + test timing hook. The workflow coordinator owns the
// overlay; tests shorten the timings through setVisualOverlayOptions().
// ---------------------------------------------------------------------------

const sharedOverlay = new ExtractionVisualOverlay();

/** Returns the visual overlay singleton the workflow coordinator renders through. */
export function getVisualOverlay(): ExtractionVisualOverlay {
  return sharedOverlay;
}

/** Overrides the overlay timing defaults; pass null to restore production values. */
export function setVisualOverlayOptions(options: ExtractionOverlayTimingOptions | null): void {
  Object.assign(EXTRACTION_OVERLAY_DEFAULTS, options ?? PRODUCTION_DEFAULTS);
  sharedOverlay.setTiming({ ...EXTRACTION_OVERLAY_DEFAULTS });
}

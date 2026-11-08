/**
 * Active Scraping Neon Scan Overlay.
 *
 * Mounts a `pointer-events: none` closed Shadow DOM host on the page while an
 * extraction run is active. It draws a laser bar, cascading item pulse boxes and
 * a floating HUD pill. The host is marked with `data-pageharvest-ignore` so the
 * navigation observers ignore its animation mutations.
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
  scanning: 'Scanning DOM...',
  scrolling: 'Scrolling...',
  navigating: 'Next page...',
  complete: '✓ Harvest Complete!',
};

interface OverlayInternals {
  root: HTMLElement | null;
  laserBar: HTMLElement | null;
  hud: HTMLElement | null;
  counter: HTMLElement | null;
  actionLabel: HTMLElement | null;
  scanLayer: HTMLElement | null;
  style: HTMLStyleElement | null;
}

/** The host's final fade; it ends exactly when the completion window does. */
const HOST_FADE_OUT_MS = 400;

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
  }

  @keyframes px-laser-slide {
    0% { background-position: 0% 50%; }
    100% { background-position: 200% 50%; }
  }

  .px-scan-box {
    position: absolute;
    border: 1.5px solid #00f5d4;
    /* Dark ring: keeps the neon outline visible (3:1) on light pages too. */
    outline: 1px solid rgba(2, 6, 23, 0.85);
    outline-offset: 0;
    border-radius: 3px;
    box-shadow: 0 0 10px rgba(0, 245, 212, 0.7), inset 0 0 6px rgba(0, 245, 212, 0.25);
    background: rgba(0, 245, 212, 0.06);
    overflow: visible;
  }

  .px-scan-box::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: -30%;
    width: 30%;
    background: linear-gradient(90deg, transparent, rgba(0, 245, 212, 0.45), transparent);
    animation: px-scan-sweep 700ms linear infinite;
  }

  @keyframes px-scan-sweep {
    from { left: -30%; }
    to { left: 105%; }
  }

  @keyframes px-scan-pop {
    from { opacity: 0; transform: scale(0.92); }
    to { transform: scale(1); }
  }

  .px-scan-badge {
    position: absolute;
    top: -10px;
    right: -4px;
    padding: 1px 5px;
    border-radius: 8px;
    background: rgba(10, 15, 28, 0.92);
    border: 1px solid rgba(0, 245, 212, 0.85);
    color: #00f5d4;
    font-size: 10px;
    font-weight: 600;
    line-height: 14px;
    white-space: nowrap;
    text-shadow: 0 0 6px rgba(0, 245, 212, 0.9);
  }

  .px-hud {
    position: absolute;
    right: 18px;
    bottom: 18px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 13px;
    border-radius: 999px;
    background: rgba(10, 15, 28, 0.92);
    border: 1px solid rgba(0, 245, 212, 0.6);
    box-shadow: 0 0 16px rgba(0, 245, 212, 0.35), 0 4px 18px rgba(0, 0, 0, 0.45);
    color: #dbe7ff;
    font-size: 12px;
    font-weight: 500;
    line-height: 16px;
    white-space: nowrap;
  }

  .px-orb {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #00f5d4;
    box-shadow: 0 0 8px rgba(0, 245, 212, 0.9), 0 0 14px rgba(16, 185, 129, 0.65);
    animation: px-orb-pulse 1s ease-in-out infinite;
    flex: none;
  }

  @keyframes px-orb-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.55; transform: scale(0.8); }
  }

  .px-counter {
    color: #00f5d4;
    font-weight: 600;
    text-shadow: 0 0 6px rgba(0, 245, 212, 0.7);
  }

  .px-action {
    color: #dbe7ff;
  }

  /* No laser, sweep, pop, pulse or fade for people who prefer reduced motion. */
  @media (prefers-reduced-motion: reduce) {
    :host, *, *::before, *::after {
      animation: none !important;
      transition: none !important;
    }
  }
`;

export class ExtractionVisualOverlay {
  private hostElement: HTMLElement | null = null;
  private internals: OverlayInternals = {
    root: null,
    laserBar: null,
    hud: null,
    counter: null,
    actionLabel: null,
    scanLayer: null,
    style: null,
  };

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

  /** Shows the laser bar + HUD; the counter starts from rows already harvested. */
  public start(options: ExtractionOverlayTimingOptions = {}, initialRows = 0): void {
    this.timing = { ...this.timing, ...options };
    this.ensureAttached();

    // A previous run's completion fade or leftover pulses must not touch this run.
    for (const timer of this.pendingTimers) clearTimeout(timer);
    this.pendingTimers.clear();
    this.internals.scanLayer?.replaceChildren();
    if (this.hostElement) this.hostElement.style.opacity = '';
    this.trackedBoxes.clear();
    document.addEventListener('scroll', this.onScroll, { capture: true, passive: true });

    this.rows = Math.max(0, initialRows);
    if (this.internals.counter) this.internals.counter.textContent = `⚡ Harvesting • ${this.rows} rows`;
    this.setAction('scanning');

    if (this.internals.laserBar) this.internals.laserBar.classList.remove('px-hidden');
    if (this.internals.hud) this.internals.hud.classList.remove('px-hidden');
    this.started = true;
  }

  /** Announces the run completion and schedules the overlay's self-removal. */
  public complete(): void {
    if (!this.started) return;
    this.setAction('complete');
    this.internals.laserBar?.classList.add('px-hidden');
    this.schedule(Math.max(0, this.timing.completionFadeMs - HOST_FADE_OUT_MS), () => {
      if (this.hostElement) this.hostElement.style.opacity = '0';
    });
    this.schedule(this.timing.completionFadeMs, () => this.destroy());
  }

  /** Updates the HUD action text. */
  public setAction(action: ExtractionOverlayAction): void {
    if (this.internals.actionLabel) {
      this.internals.actionLabel.textContent = ACTION_LABELS[action];
    }
  }

  /** Adds harvested rows to the live counter. */
  public addRows(count: number): void {
    this.rows += count;
    if (this.internals.counter) {
      this.internals.counter.textContent = `⚡ Harvesting • ${this.rows} rows`;
    }
  }

  /**
   * Pulses glowing bounding boxes over up to `maxVisibleItems` visible items matching
   * the container selector. Off-screen and zero-sized elements are skipped.
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
    visible.forEach((entry, index) => {
      this.spawnPulseBox(entry.element, entry.rect, index + 1, this.timing.pulseStaggerMs * index);
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
    this.internals = {
      root: null,
      laserBar: null,
      hud: null,
      counter: null,
      actionLabel: null,
      scanLayer: null,
      style: null,
    };
    this.started = false;
  }

  // ---------------------------------------------------------------------------

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

    const root = document.createElement('div');
    root.className = 'px-root';

    const laserBar = document.createElement('div');
    laserBar.className = 'px-laser-bar px-hidden';

    const scanLayer = document.createElement('div');
    scanLayer.className = 'px-scan-layer';

    const hud = document.createElement('div');
    hud.className = 'px-hud px-hidden';

    const orb = document.createElement('span');
    orb.className = 'px-orb';

    const counter = document.createElement('span');
    counter.className = 'px-counter';
    counter.textContent = '⚡ Harvesting • 0 rows';

    const actionLabel = document.createElement('span');
    actionLabel.className = 'px-action';
    actionLabel.textContent = ACTION_LABELS.scanning;

    hud.appendChild(orb);
    hud.appendChild(counter);
    hud.appendChild(actionLabel);

    root.appendChild(laserBar);
    root.appendChild(scanLayer);
    root.appendChild(hud);

    shadowRoot.appendChild(root);

    this.internals = {
      root,
      laserBar,
      hud,
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
    // Cascade: the entrance pop starts after `delayMs`; during the delay the
    // backwards keyframe fill keeps the box invisible.
    box.style.animation = `px-scan-pop 180ms ease ${delayMs}ms both`;

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

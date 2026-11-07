import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext, type CDPSession, type Page } from '@playwright/test';
import { expect, test } from './release-test';

/**
 * Real-Chromium verification of the Neon Indicator Overlays against the built
 * unpacked extension. Both overlays live in closed shadow roots, which page
 * scripts cannot reach, so the tests read them through the DevTools protocol:
 * that reports what the browser actually laid out, including display:none.
 * Screenshots of each state are saved to test-results/ as visual proof.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = 'http://127.0.0.1:3456';
const EXTENSION_PATH = path.resolve(HERE, '../../.output/chrome-mv3');
const SHOTS_DIR = path.resolve(HERE, '../../test-results');

const PICKER_HOST = 'pageharvest-picker-overlay-host';
const SCAN_HOST = 'pageharvest-extraction-overlay-host';

interface DomNode {
  nodeId: number;
  nodeName: string;
  nodeType: number;
  nodeValue?: string;
  attributes?: string[];
  children?: DomNode[];
  shadowRoots?: DomNode[];
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface StoredJob {
  id: string;
  datasetId: string;
  status: string;
  stopReason?: string;
  totalExtracted: number;
  pagesVisited: number;
}

function attribute(node: DomNode, name: string): string | undefined {
  const attrs = node.attributes ?? [];
  for (let i = 0; i + 1 < attrs.length; i += 2) {
    if (attrs[i] === name) return attrs[i + 1];
  }
  return undefined;
}

function descendants(node: DomNode): DomNode[] {
  const nested = [...(node.children ?? []), ...(node.shadowRoots ?? [])];
  return [node, ...nested.flatMap(descendants)];
}

function textOf(node: DomNode | undefined): string {
  if (!node) return '';
  return descendants(node)
    .filter((candidate) => candidate.nodeType === 3)
    .map((candidate) => candidate.nodeValue ?? '')
    .join('');
}

/** One read of a closed shadow root, as the browser currently has it. */
class ShadowView {
  constructor(
    private readonly session: CDPSession,
    private readonly nodes: DomNode[]
  ) {}

  all(className: string): DomNode[] {
    return this.nodes.filter((node) => (attribute(node, 'class') ?? '').split(/\s+/).includes(className));
  }

  one(className: string): DomNode {
    const [node] = this.all(className);
    if (!node) throw new Error(`.${className} is not in the shadow root.`);
    return node;
  }

  /** The laid-out border box, or null when the browser renders no box (display:none). */
  async box(node: DomNode): Promise<Box | null> {
    try {
      const { model } = (await this.session.send('DOM.getBoxModel', { nodeId: node.nodeId })) as {
        model: { border: number[]; width: number; height: number };
      };
      return { x: model.border[0], y: model.border[1], width: model.width, height: model.height };
    } catch {
      return null;
    }
  }

  async computed(node: DomNode): Promise<Map<string, string>> {
    await this.session.send('CSS.enable');
    const { computedStyle } = (await this.session.send('CSS.getComputedStyleForNode', {
      nodeId: node.nodeId,
    })) as { computedStyle: Array<{ name: string; value: string }> };
    return new Map(computedStyle.map((entry) => [entry.name, entry.value]));
  }
}

/** Reads the host's closed shadow root, or null when the host is not in the document. */
async function readShadow(session: CDPSession, hostId: string): Promise<ShadowView | null> {
  const { root } = (await session.send('DOM.getDocument', { depth: -1, pierce: true })) as { root: DomNode };
  const host = descendants(root).find((node) => attribute(node, 'id') === hostId);
  const shadow = host?.shadowRoots?.[0];
  return shadow ? new ShadowView(session, descendants(shadow)) : null;
}

async function requireShadow(session: CDPSession, hostId: string): Promise<ShadowView> {
  const view = await readShadow(session, hostId);
  if (!view) throw new Error(`#${hostId} exposed no shadow root.`);
  return view;
}

interface HudSample {
  at: number;
  counter: string;
  action: string;
  rows: number;
  hud: Box | null;
  laser: Box | null;
  scanBoxes: number;
  badges: string[];
}

async function sampleHud(session: CDPSession): Promise<HudSample | null> {
  const view = await readShadow(session, SCAN_HOST);
  if (!view) return null;
  const counter = textOf(view.one('px-counter'));
  // Read the laser first: the HUD is shown for the overlay's whole life, so a missing
  // HUD box means the host was removed mid-read and this snapshot is stale.
  const laser = await view.box(view.one('px-laser-bar'));
  const hud = await view.box(view.one('px-hud'));
  if (!hud) return null;
  return {
    at: Date.now(),
    counter,
    action: textOf(view.one('px-action')),
    rows: Number(/(\d+) rows/.exec(counter)?.[1] ?? NaN),
    hud,
    laser,
    scanBoxes: view.all('px-scan-box').length,
    badges: view.all('px-scan-badge').map((badge) => textOf(badge)),
  };
}

interface SamplerOptions {
  /** Taken once, the first time a sample satisfies `when`. */
  shots?: Array<{ file: string; when: (sample: HudSample) => boolean }>;
  /** The overlay legitimately disappears between documents on multi-page runs. */
  isFinished: (samples: HudSample[]) => boolean;
  timeoutMs: number;
}

/**
 * Polls the HUD from before the job starts until the overlay has gone for good.
 * Reads made while a document is being replaced can throw; those are skipped.
 */
function recordHud(session: CDPSession, options: SamplerOptions): Promise<{
  samples: HudSample[];
  removedAt: number | null;
}> {
  const pendingShots = [...(options.shots ?? [])];
  return (async () => {
    const samples: HudSample[] = [];
    const deadline = Date.now() + options.timeoutMs;
    while (Date.now() < deadline) {
      let sample: HudSample | null;
      try {
        sample = await sampleHud(session);
      } catch {
        continue;
      }
      if (sample) {
        samples.push(sample);
        const shotIndex = pendingShots.findIndex((shot) => shot.when(sample as HudSample));
        if (shotIndex >= 0) {
          const [shot] = pendingShots.splice(shotIndex, 1);
          // Direct capture: page.screenshot() computes a clip first, and a page that is
          // auto-scrolling moves under that clip, which tears the image.
          const { data } = (await session.send('Page.captureScreenshot', { format: 'png' })) as { data: string };
          await fs.writeFile(path.join(SHOTS_DIR, shot.file), Buffer.from(data, 'base64'));
        }
      } else if (options.isFinished(samples)) {
        return { samples, removedAt: Date.now() };
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return { samples, removedAt: null };
  })();
}

function readTable<T>(panel: Page, table: string): Promise<T[]> {
  return panel.evaluate(
    (name) =>
      new Promise<T[]>((resolve, reject) => {
        const open = indexedDB.open('PageHarvestDB');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction(name).objectStore(name).getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            db.close();
            resolve(request.result as T[]);
          };
        };
      }),
    table
  );
}

async function waitForCompletedJob(panel: Page, known: Set<string>): Promise<StoredJob> {
  let found: StoredJob | undefined;
  await expect
    .poll(
      async () => {
        found = (await readTable<StoredJob>(panel, 'jobs')).find(
          (job) => job.status === 'COMPLETED' && !known.has(job.id)
        );
        return found !== undefined;
      },
      { timeout: 45000, intervals: [100, 200, 300] }
    )
    .toBe(true);
  return found as StoredJob;
}

const COMPLETE_TEXT = '✓ Harvest Complete!';

interface FadeLog {
  fadeStartedAt: number | null;
  midFadeOpacity: number | null;
  removedAt: number | null;
}

/**
 * Times the overlay's exit from inside the page. Polling over CDP can stall for hundreds
 * of milliseconds, longer than the fade itself, so it cannot measure this reliably.
 */
async function watchOverlayExit(page: Page): Promise<() => Promise<FadeLog>> {
  const handle = await page.evaluateHandle((hostId) => {
    const log: FadeLog = { fadeStartedAt: null, midFadeOpacity: null, removedAt: null };
    new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target as HTMLElement;
        if (record.type === 'attributes' && target.id === hostId && target.style.opacity === '0') {
          if (log.fadeStartedAt === null) {
            log.fadeStartedAt = performance.now();
            setTimeout(() => {
              log.midFadeOpacity = Number(getComputedStyle(target).opacity);
            }, 150);
          }
        }
        for (const node of Array.from(record.removedNodes)) {
          if ((node as HTMLElement).id === hostId) log.removedAt = performance.now();
        }
      }
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
    return log;
  }, SCAN_HOST);
  return () => handle.jsonValue();
}

test.describe('Neon Indicator Overlays in real Chromium', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120000);

  let context: BrowserContext;
  let extensionId: string;
  let profile: string;
  const finishedJobs = new Set<string>();

  test.beforeAll(async () => {
    await fs.mkdir(SHOTS_DIR, { recursive: true });
    profile = await fs.mkdtemp(path.join(os.tmpdir(), 'pageharvest-neon-profile-'));
    context = await chromium.launchPersistentContext(profile, {
      headless: false,
      viewport: { width: 1280, height: 720 },
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15000 }));
    extensionId = worker.url().split('/')[2];
  });

  test.afterAll(async () => {
    await context?.close();
    await fs.rm(profile, { recursive: true, force: true });
  });

  async function open(url: string): Promise<{ panel: Page; target: Page; session: CDPSession; pageErrors: string[] }> {
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    const target = await context.newPage();
    const pageErrors: string[] = [];
    target.on('pageerror', (error) => pageErrors.push(error.message));
    await target.goto(url);
    await target.waitForLoadState('domcontentloaded');
    await target.bringToFront();
    const session = await context.newCDPSession(target);
    return { panel, target, session, pageErrors };
  }

  async function configure(panel: Page): Promise<void> {
    await expect(panel.getByRole('button', { name: 'Auto-Detect Lists' })).toBeEnabled({ timeout: 10000 });
    await panel.getByRole('button', { name: 'Auto-Detect Lists' }).click();
    await panel.getByRole('button', { name: 'Next: Choose Fields' }).click({ timeout: 10000 });
    await expect(panel.getByText('Columns to Extract')).toBeVisible();
    await expect(panel.getByRole('button', { name: /Start Extraction/ })).toBeEnabled({ timeout: 10000 });
  }

  test('Neon Hover Picker: hover and click paint the neon box, corners, badge and pattern', async () => {
    const { panel, target, session, pageErrors } = await open(`${FIXTURES}/simple-grid.html`);

    await panel.getByRole('button', { name: 'Select Elements' }).click();
    await expect(panel.getByText('Visual Element Picker Active')).toBeVisible();

    const price = target.locator('.product-price').first();
    await price.hover();

    const host = target.locator(`#${PICKER_HOST}`);
    await expect(host).toBeAttached();
    await expect(host).toHaveAttribute('data-pageharvest-ignore', 'true');
    expect(await host.evaluate((element) => element.shadowRoot)).toBeNull();
    const hostBox = await host.boundingBox();
    expect(hostBox?.width).toBeGreaterThan(0);
    expect(hostBox?.height).toBeGreaterThan(0);

    // The box settles on exactly the hovered element once the 80ms interpolation ends.
    const priceBox = await price.boundingBox();
    if (!priceBox) throw new Error('The hovered price has no box.');
    await expect
      .poll(async () => {
        const view = await requireShadow(session, PICKER_HOST);
        const box = await view.box(view.one('ph-hover-box'));
        return box && [box.x, box.y, box.width, box.height].map(Math.round);
      })
      .toEqual([priceBox.x, priceBox.y, priceBox.width, priceBox.height].map(Math.round));

    const hovering = await requireShadow(session, PICKER_HOST);
    const hoverBox = hovering.one('ph-hover-box');
    const hoverStyle = await hovering.computed(hoverBox);
    expect(hoverStyle.get('border-top-style')).toBe('solid');
    expect(parseFloat(hoverStyle.get('border-top-width') ?? '0')).toBeGreaterThan(0);
    expect(hoverStyle.get('border-top-color')).toBe('rgb(0, 245, 212)');
    expect(hoverStyle.get('box-shadow')).toContain('rgba(0, 245, 212, 0.75)');
    expect(hoverStyle.get('box-shadow')).toContain('inset');
    expect(hoverStyle.get('background-image')).toContain('linear-gradient');
    expect(hoverStyle.get('transition-duration')).toContain('0.08s');

    // Four corner accents, each really laid out, inside the hover box.
    const corners = descendantsWithClass(hoverBox, 'ph-corner-accent');
    expect(corners).toHaveLength(4);
    for (const corner of corners) {
      const box = await hovering.box(corner);
      expect(box?.width).toBeGreaterThan(0);
      expect(box?.height).toBeGreaterThan(0);
    }

    // The tooltip badge: visible, glassmorphic, and naming the hovered element.
    const badge = hovering.one('ph-hover-badge');
    const badgeBox = await hovering.box(badge);
    expect(badgeBox?.width).toBeGreaterThan(0);
    expect(textOf(badge)).toContain('div.product-price');
    const badgeStyle = await hovering.computed(badge);
    expect(badgeStyle.get('background-color')).toBe('rgba(10, 15, 28, 0.92)');
    expect(badgeStyle.get('backdrop-filter')).toBe('blur(8px)');
    expect(badgeStyle.get('color')).toBe('rgb(0, 245, 212)');
    expect(badgeStyle.get('border-top-color')).toContain('0, 245, 212');

    // Nothing is selected yet, so neither the selection box nor the toolbar may render.
    // The toolbar takes pointer events: a stray one blocks picking whatever is under it.
    expect(await hovering.box(hovering.one('ph-selection-box'))).toBeNull();
    expect(await hovering.box(hovering.one('ph-toolbar'))).toBeNull();

    await target.screenshot({ path: path.join(SHOTS_DIR, 'neon-picker-hover.png') });

    // Lock the element: emerald/violet pulse, and the whole pattern lights up.
    await price.click();
    await expect(panel.getByText('Repeating Elements Found')).toBeVisible();
    await expect(panel.getByText('3 items detected')).toBeVisible();

    await expect
      .poll(async () => (await requireShadow(session, PICKER_HOST)).all('ph-similar-box').length)
      .toBe(2);
    const locked = await requireShadow(session, PICKER_HOST);
    const selection = locked.one('ph-selection-box');
    expect(await locked.box(selection)).not.toBeNull();
    const selectionStyle = await locked.computed(selection);
    expect(selectionStyle.get('border-top-color')).toBe('rgb(16, 185, 129)');
    expect(selectionStyle.get('animation-name')).toBe('ph-selection-pulse');
    expect(selectionStyle.get('box-shadow')).toContain('168, 85, 247');
    expect(descendantsWithClass(selection, 'ph-corner-accent')).toHaveLength(4);
    expect(textOf(locked.one('ph-selection-badge'))).toContain('3 matches');
    expect(await locked.box(locked.one('ph-toolbar'))).not.toBeNull();

    const expectedSiblings = await target.locator('.product-price').evaluateAll((elements) =>
      elements.slice(1).map((element) => {
        const rect = element.getBoundingClientRect();
        return [Math.round(rect.left), Math.round(rect.top)];
      })
    );
    const similarBoxes = locked.all('ph-similar-box');
    const renderedSiblings = [];
    for (const similar of similarBoxes) {
      const box = await locked.box(similar);
      renderedSiblings.push(box && [Math.round(box.x), Math.round(box.y)]);
      const style = await locked.computed(similar);
      expect(style.get('border-top-style')).toBe('dashed');
      expect(style.get('animation-name')).toBe('ph-similar-pulse');
    }
    expect(renderedSiblings).toEqual(expectedSiblings);

    await target.screenshot({ path: path.join(SHOTS_DIR, 'neon-picker-selected.png') });

    await target.keyboard.press('Escape');
    await expect(target.locator(`#${PICKER_HOST}`)).toHaveCount(0);
    expect(pageErrors).toEqual([]);

    await target.close();
    await panel.close();
  });

  test('Active Scraping: laser, pulses and live HUD follow a real multi-batch run, then clean up', async () => {
    const { panel, target, session, pageErrors } = await open(`${FIXTURES}/long-scroll.html`);
    await configure(panel);
    await panel.getByRole('button', { name: /Infinite Scroll/ }).click();
    await panel.getByLabel('Max Scrolls').fill('3');
    await panel.getByLabel('Scroll Delay (ms)').fill('500');

    expect(await target.locator(`#${SCAN_HOST}`).count()).toBe(0);

    const readExit = await watchOverlayExit(target);
    const recording = recordHud(session, {
      timeoutMs: 60000,
      isFinished: (samples) => samples.some((sample) => sample.action === COMPLETE_TEXT),
      shots: [
        {
          file: 'neon-scraping-hud.png',
          when: (sample) => sample.scanBoxes > 0 && sample.rows > 0 && sample.action !== COMPLETE_TEXT,
        },
        { file: 'neon-scraping-complete.png', when: (sample) => sample.action === COMPLETE_TEXT },
      ],
    });

    await panel.getByRole('button', { name: /Start Extraction/ }).click();

    const scanHost = target.locator(`#${SCAN_HOST}`);
    await expect(scanHost).toBeAttached({ timeout: 15000 });
    await expect(scanHost).toHaveAttribute('data-pageharvest-ignore', 'true');
    expect(await scanHost.evaluate((element) => element.shadowRoot)).toBeNull();
    const hostStyle = await scanHost.evaluate((element) => {
      const style = getComputedStyle(element);
      return { pointerEvents: style.pointerEvents, zIndex: style.zIndex, position: style.position };
    });
    expect(hostStyle).toEqual({ pointerEvents: 'none', zIndex: '2147483646', position: 'fixed' });

    const { samples, removedAt } = await recording;
    const job = await waitForCompletedJob(panel, finishedJobs);
    finishedJobs.add(job.id);

    // While running, the laser spans the top of the viewport; it stops at completion.
    // The HUD pill stays visible in the bottom-right throughout.
    expect(samples.length).toBeGreaterThan(5);
    const viewportWidth = target.viewportSize()?.width ?? 0;
    const lastRunning = samples.filter((sample) => sample.action !== COMPLETE_TEXT).at(-1);
    for (const sample of samples) {
      if (sample.action === COMPLETE_TEXT) {
        expect(sample.laser).toBeNull();
      } else if (sample !== lastRunning) {
        // The last running sample is exempt: completion can land between its text read
        // and its box read. A laser lost at any earlier point in the run still fails.
        expect(sample.laser).toMatchObject({ x: 0, y: 0, width: viewportWidth, height: 3 });
      }
      expect(sample.hud?.width).toBeGreaterThan(0);
      expect(sample.hud?.x ?? 0).toBeGreaterThan(viewportWidth / 2);
    }

    // The counter only ever climbs, moved in steps as batches committed, and agrees with storage.
    const rows = samples.map((sample) => sample.rows);
    expect(rows.every((value) => Number.isFinite(value))).toBe(true);
    expect(rows).toEqual([...rows].sort((a, b) => a - b));
    expect(new Set(rows.filter((value) => value > 0)).size).toBeGreaterThan(1);
    expect(job.totalExtracted).toBeGreaterThan(0);
    expect(rows.at(-1)).toBe(job.totalExtracted);
    expect(samples.at(-1)?.counter).toBe(`⚡ Harvesting • ${job.totalExtracted} rows`);

    // The action text followed the run.
    const actions = new Set(samples.map((sample) => sample.action));
    expect(actions.has('Scrolling...')).toBe(true);
    expect(samples.at(-1)?.action).toBe(COMPLETE_TEXT);

    // Item pulses really rendered, capped, with ✓ #N badges, and then faded away.
    const pulsing = samples.filter((sample) => sample.scanBoxes > 0);
    expect(pulsing.length).toBeGreaterThan(0);
    expect(Math.max(...samples.map((sample) => sample.scanBoxes))).toBeLessThanOrEqual(25);
    expect(pulsing.flatMap((sample) => sample.badges)).toContain('✓ #1');
    expect(samples.at(-1)?.scanBoxes).toBe(0);

    // Completion lingers ~2.5s. Sampling brackets the true moment it was announced:
    // after the last running sample, no later than the first complete one.
    expect(removedAt).not.toBeNull();
    const firstComplete =samples.find((sample) => sample.action === COMPLETE_TEXT);
    expect((removedAt as number) - (lastRunning?.at ?? 0)).toBeGreaterThan(2400);
    expect((removedAt as number) - (firstComplete?.at ?? 0)).toBeLessThan(3500);

    // It fades out rather than popping: opacity is mid-transition, then the host goes.
    const exit = await readExit();
    expect(exit.fadeStartedAt).not.toBeNull();
    expect(exit.removedAt).not.toBeNull();
    const fadeMs = (exit.removedAt as number) - (exit.fadeStartedAt as number);
    expect(fadeMs).toBeGreaterThan(300);
    expect(fadeMs).toBeLessThan(700);
    expect(exit.midFadeOpacity).toBeGreaterThan(0);
    expect(exit.midFadeOpacity).toBeLessThan(1);
    await expect(scanHost).toHaveCount(0);

    // The animations did not disturb the run: it ended on its configured limit, and
    // nothing of the overlay leaked into the records.
    expect(job.stopReason).toBe('max_scrolls_reached');
    const records = (await readTable<Record<string, unknown>>(panel, 'records')).filter(
      (row) => row.datasetId === job.datasetId
    );
    expect(records).toHaveLength(job.totalExtracted);
    expect(JSON.stringify(records)).not.toContain('Harvesting');
    expect(pageErrors).toEqual([]);

    await target.close();
    await panel.close();
  });

  test.describe('across documents (Next Button)', () => {
    let hudRows: number[] = [];
    let jobTotal = 0;

    test('the overlay remounts on each page, completes on the last, and cleans up', async () => {
      const { panel, target, session, pageErrors } = await open(`${FIXTURES}/next-page-pagination.html`);
      await configure(panel);
      await panel.getByRole('button', { name: /Next Button/ }).click();
      await panel.getByLabel('Delay Between Pages (ms)').fill('200');

      const recording = recordHud(session, {
        timeoutMs: 60000,
        isFinished: (samples) => samples.some((sample) => sample.action === COMPLETE_TEXT),
      });
      await panel.getByRole('button', { name: /Start Extraction/ }).click();

      const { samples, removedAt } = await recording;
      const job = await waitForCompletedJob(panel, finishedJobs);
      finishedJobs.add(job.id);

      expect(job.pagesVisited).toBe(2);
      expect(job.totalExtracted).toBe(6);
      expect(target.url()).toContain('next-page-p2.html');
      expect(samples.at(-1)?.action).toBe(COMPLETE_TEXT);
      expect(removedAt).not.toBeNull();
      await expect(target.locator(`#${SCAN_HOST}`)).toHaveCount(0);
      expect(pageErrors).toEqual([]);

      hudRows = samples.map((sample) => sample.rows);
      jobTotal = job.totalExtracted;

      await target.close();
      await panel.close();
    });

    test('the live row counter keeps the running total across pages', () => {
      // Each document's overlay starts from JobResumeState.recordsExtracted (ADR-029).
      expect(jobTotal).toBe(6);
      expect(hudRows.at(-1)).toBe(jobTotal);
    });
  });
});

function descendantsWithClass(node: DomNode, className: string): DomNode[] {
  return descendants(node).filter((candidate) =>
    (attribute(candidate, 'class') ?? '').split(/\s+/).includes(className)
  );
}

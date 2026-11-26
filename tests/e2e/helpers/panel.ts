/**
 * Side panel steps shared by the Playwright specs. The List Extractor now opens a
 * 2-step setup screen (ADR-032, ADR-039): "Click to Pick List"/"Auto-detect on this
 * page", then a found-list card with "Edit columns", "Re-pick" and the Load More
 * options. Table and Links still show the detailed result card and column panel.
 * Specs call these helpers instead of repeating labels, so a copy change is fixed
 * in one place.
 */
import type { Page, Worker } from '@playwright/test';
import { GUIDE_STORAGE_KEY } from '../../../src/components/guide/preferences';
import { ADVANCED_STORAGE_KEY } from '../../../src/components/settings/advanced-preference';
import { CONSENT_STORAGE_KEY } from '../../../src/components/consent/consent';

/** Marks user consent as granted in chrome.storage.local (B2 ConsentGate). Call before opening the panel. */
export async function markConsentGiven(worker: Worker): Promise<void> {
  await worker.evaluate(async (key) => {
    await chrome.storage.local.set({
      [key]: { accepted: true, version: '1.0', acceptedAt: new Date().toISOString() },
    });
  }, CONSENT_STORAGE_KEY);
}

/** If the ConsentGate dialog is currently presented on the given page, click accept. */
export async function acceptConsentIfPresent(page: Page): Promise<void> {
  try {
    const btn = page.getByRole('button', { name: 'I understand, continue' });
    if (await btn.isVisible({ timeout: 1500 })) {
      await btn.click();
    }
  } catch {
    // Already dismissed or not present
  }
}

/** Marks the first-run tour as seen, so it does not cover the panel. Call before opening it. */
export async function markTourSeen(worker: Worker): Promise<void> {
  await worker.evaluate(async (key) => {
    await chrome.storage.local.set({ [key]: { version: 1, onboardingDone: true } });
  }, GUIDE_STORAGE_KEY);
  await markConsentGiven(worker);
}

/**
 * Turns Advanced options on (ADR-039). The specs written before simple mode drive the
 * detailed controls, so they are the proof that nothing was lost when it is on.
 */
export async function enableAdvancedOptions(worker: Worker): Promise<void> {
  await worker.evaluate(async (key) => {
    await chrome.storage.local.set({ [key]: { version: 1, advanced: true } });
  }, ADVANCED_STORAGE_KEY);
}

export type StartTool = 'auto' | 'pick' | 'table' | 'links';

const START_BUTTON: Record<StartTool, string | RegExp> = {
  auto: 'Find Data on This Page',
  pick: 'Pick element on page',
  table: 'Extract a table',
  links: 'Extract all links',
};

/** The tool card for a start option. All four sit in the Tool Hub, always visible. */
export async function startButton(panel: Page, tool: StartTool) {
  return panel.getByRole('button', { name: START_BUTTON[tool] });
}

export async function startWith(panel: Page, tool: StartTool): Promise<void> {
  const button = await startButton(panel, tool);
  await button.waitFor({ timeout: 10000 });
  await button.click();
}

/** Clicks the List Extractor card, then Auto-detect, opening ListSetupView with detected items. */
export async function startListExtraction(panel: Page): Promise<void> {
  await startWith(panel, 'auto');
  const autoDetect = panel.getByRole('button', { name: /Auto-detect on this page/i });
  await autoDetect.waitFor({ state: 'visible', timeout: 15000 });
  await autoDetect.click();
}

/**
 * The detected-list summary. The List Extractor shows "Found N items · M columns";
 * Table/Links still show "N similar items found" on the result card. Both name the
 * count, so either one proves that detection found a list.
 */
export const resultHeading = (panel: Page) =>
  panel
    .getByText(/Found \d[\d,]* items/)
    .or(panel.getByText(/^\d[\d,]* similar items? found$/))
    .first();

/** The column controls heading in ListSetupView (inline editor) or the detailed flow. */
export const reviewFieldsHeading = (panel: Page) =>
  panel.getByText('Choose your columns').or(panel.getByRole('button', { name: 'Edit columns' })).first();

/** "Start Extraction", on the new ListSetupView or the detailed flow. */
export const startExtraction = (panel: Page) => panel.getByRole('button', { name: /Start Extraction|Start extraction/ });

/** Pagination options are always visible in ListSetupView's second card once a list is found. */
export async function goToPagination(panel: Page): Promise<void> {
  await panel.getByText('② Load More Items').waitFor({ timeout: 15000 });
}

/** Moves from Pagination back to the list setup, if the detailed flow is present. */
export async function goToFields(panel: Page): Promise<void> {
  const back = panel.getByRole('button', { name: 'Back to fields' });
  if (await back.isVisible()) await back.click();
  await reviewFieldsHeading(panel).waitFor();
}

export type PaginationMode = 'none' | 'next_button' | 'infinite_scroll' | 'url_template';

const MODE_LABEL: Record<PaginationMode, string> = {
  none: 'This Page Only',
  next_button: 'Pagination',
  infinite_scroll: 'Auto-Scroll',
  url_template: 'Pagination',
};

export async function choosePagination(panel: Page, mode: PaginationMode): Promise<void> {
  await goToPagination(panel);
  await panel.getByRole('radio', { name: new RegExp(MODE_LABEL[mode], 'i') }).check();
}

async function openAdvanced(panel: Page): Promise<void> {
  const toggle = panel.getByRole('button', { name: /Limits & timing/i });
  if (await toggle.count()) {
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    return;
  }
  const advanced = panel.getByRole('button', { name: 'Advanced' });
  if (await advanced.count() && (await advanced.getAttribute('aria-expanded')) !== 'true') await advanced.click();
}

export interface PaginationLimits {
  maxPages?: number;
  delayMs?: number;
  maxScrolls?: number;
  scrollDelayMs?: number;
  maxRecords?: number;
  nextButtonSelector?: string;
}

/** Fills limits. In the new flow waits are typed in milliseconds; in the detailed flow, seconds. */
export async function setLimits(panel: Page, limits: PaginationLimits): Promise<void> {
  await openAdvanced(panel);
  if (limits.maxPages !== undefined) {
    await panel.getByLabel('Max pages').or(panel.getByLabel('Most pages')).first().fill(String(limits.maxPages));
  }
  if (limits.delayMs !== undefined) {
    // ListSetupView takes milliseconds; the detailed panel takes seconds.
    const msInput = panel.getByLabel('Delay (min 1,000 ms)');
    if (await msInput.count()) {
      await msInput.fill(String(Math.max(1000, limits.delayMs)));
    } else {
      await panel.getByLabel('Wait between pages (seconds)').fill(String(limits.delayMs / 1000));
    }
  }
  if (limits.maxScrolls !== undefined) {
    await panel.getByLabel('Max scrolls').or(panel.getByLabel('Most scrolls')).first().fill(String(limits.maxScrolls));
  }
  if (limits.scrollDelayMs !== undefined) {
    const msInput = panel.getByLabel('Delay (min 1,000 ms)');
    if (await msInput.count()) {
      await msInput.fill(String(Math.max(1000, limits.scrollDelayMs)));
    } else {
      await panel.getByLabel('Wait between scrolls (seconds)').fill(String(limits.scrollDelayMs / 1000));
    }
  }
  if (limits.maxRecords !== undefined) await panel.getByLabel('Stop after this many rows').fill(String(limits.maxRecords));
  if (limits.nextButtonSelector !== undefined) {
    await panel.getByLabel('Next button selector (optional)').fill(limits.nextButtonSelector);
  }
}

/** Reads a limit back, in the unit the contract stores (milliseconds for waits). */
export async function readLimit(panel: Page, limit: 'maxPages' | 'maxScrolls'): Promise<string> {
  await openAdvanced(panel);
  const name = limit === 'maxPages' ? ['Max pages', 'Most pages'] : ['Max scrolls', 'Most scrolls'];
  return panel.getByLabel(name[0]).or(panel.getByLabel(name[1])).first().inputValue();
}

/** The URL template field, after choosing "Page numbers in the URL". */
export async function setUrlTemplate(panel: Page, template: string): Promise<void> {
  await choosePagination(panel, 'url_template');
  await panel.getByLabel('Page address').fill(template);
}

/** Run screen and recovery copy (new ListRunningView copy first, legacy copy as fallback). */
export const RUN = {
  running: 'Live Extraction Stage',
  paused: 'Paused',
  cancel: 'Stop extraction',
  finish: /Extraction complete/,
  interrupted: 'Extraction interrupted',
  resume: 'Resume',
} as const;

/** Discards an interrupted job, confirming in the dialog that its rows are kept. */
export async function discardInterrupted(panel: Page): Promise<void> {
  await panel.getByRole('button', { name: 'Discard', exact: true }).click();
  await panel.getByRole('dialog', { name: 'Discard this interrupted job?' }).waitFor();
  await panel.getByRole('button', { name: 'Discard job' }).click();
}

/** The export dialog. */
export const exportDialog = (panel: Page) => panel.getByRole('dialog', { name: 'Export data' });

/** "N similar items found" on the legacy result card, or "Found N items" in ListSetupView. */
export const itemsFound = (panel: Page, count: number) =>
  panel
    .getByText(`${count} similar ${count === 1 ? 'item' : 'items'} found`)
    .or(panel.getByText(new RegExp(`Found ${count} items`)))
    .first();

export interface DownloadSnapshot {
  id: number;
  state: string;
  filename: string;
  error?: string;
}

/**
 * Waits for a download that is not in `before` to finish, and returns it. Chrome on Windows
 * scans each file before it marks the download complete, which can take several seconds on a
 * busy machine, so this allows 30 seconds. A download Chrome reports as interrupted fails at once.
 */
export async function waitForCompletedDownload(
  page: Page,
  before: Iterable<number>,
  timeoutMs = 30000
): Promise<DownloadSnapshot> {
  const known = new Set(before);
  const deadline = Date.now() + timeoutMs;
  let latest: DownloadSnapshot[] = [];
  while (Date.now() < deadline) {
    latest = await page.evaluate(async () =>
      (await chrome.downloads.search({ orderBy: ['-startTime'], limit: 20 })).map((item) => ({
        id: item.id,
        state: item.state,
        filename: item.filename,
        error: item.error,
      }))
    );
    const fresh = latest.filter((item) => !known.has(item.id));
    const interrupted = fresh.find((item) => item.state === 'interrupted');
    if (interrupted) throw new Error(`The download was interrupted: ${interrupted.error ?? 'no reason given'}`);
    const completed = fresh.find((item) => item.state === 'complete');
    if (completed) return completed;
    await page.waitForTimeout(250);
  }
  throw new Error(`No download completed within ${timeoutMs} ms: ${JSON.stringify(latest)}`);
}

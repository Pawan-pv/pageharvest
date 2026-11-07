/**
 * Side panel steps shared by the Playwright specs. They follow the redesigned flow
 * (ADR-032): start options, the result card, Review fields, Pagination with its
 * collapsed Advanced section, and the run screen. Specs call these instead of
 * repeating labels, so a copy change is fixed in one place.
 */
import type { Page, Worker } from '@playwright/test';
import { GUIDE_STORAGE_KEY } from '../../../src/components/guide/preferences';

/** Marks the first-run tour as seen, so it does not cover the panel. Call before opening it. */
export async function markTourSeen(worker: Worker): Promise<void> {
  await worker.evaluate(async (key) => {
    await chrome.storage.local.set({ [key]: { version: 1, onboardingDone: true } });
  }, GUIDE_STORAGE_KEY);
}

export type StartTool = 'auto' | 'pick' | 'table' | 'links';

const START_BUTTON: Record<StartTool, string> = {
  auto: 'Find data automatically',
  pick: 'Pick items myself',
  table: 'Extract a table',
  links: 'Extract all links',
};

/** The start option's button. Table and Links sit under "More ways to start". */
export async function startButton(panel: Page, tool: StartTool) {
  if (tool === 'table' || tool === 'links') {
    const more = panel.getByText('More ways to start');
    await more.waitFor({ timeout: 10000 });
    const details = panel.locator('details', { has: more });
    if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) await more.click();
  }
  return panel.getByRole('button', { name: START_BUTTON[tool], exact: true });
}

export async function startWith(panel: Page, tool: StartTool): Promise<void> {
  const button = await startButton(panel, tool);
  await button.waitFor({ timeout: 10000 });
  await button.click();
}

/** The result card's confirm button. */
export const useThisList = (panel: Page) => panel.getByRole('button', { name: 'Use this list', exact: true });

/** The heading of the result card. */
export const resultHeading = (panel: Page) => panel.getByRole('heading', { name: 'Is this the data you want?' });

/** The Review fields heading. */
export const reviewFieldsHeading = (panel: Page) => panel.getByText('Choose your columns');

/** "Start extraction (N columns)", on Review fields or Pagination. */
export const startExtraction = (panel: Page) => panel.getByRole('button', { name: /Start extraction/ });

/** Moves from Review fields to Pagination, if not there already. */
export async function goToPagination(panel: Page): Promise<void> {
  const next = panel.getByRole('button', { name: 'Next: Pagination' });
  if (await next.isVisible()) await next.click();
  await panel.getByRole('group', { name: /How does this site show more items/ }).waitFor();
}

/** Moves from Pagination back to Review fields, if not there already. */
export async function goToFields(panel: Page): Promise<void> {
  const back = panel.getByRole('button', { name: 'Back to fields' });
  if (await back.isVisible()) await back.click();
  await reviewFieldsHeading(panel).waitFor();
}

export type PaginationMode = 'none' | 'next_button' | 'infinite_scroll' | 'url_template';

const MODE_LABEL: Record<PaginationMode, string> = {
  none: 'Just this page',
  next_button: 'Click a Next button',
  infinite_scroll: 'Scroll to load more',
  url_template: 'Page numbers in the URL',
};

export async function choosePagination(panel: Page, mode: PaginationMode): Promise<void> {
  await goToPagination(panel);
  await panel.getByRole('radio', { name: MODE_LABEL[mode] }).check();
}

async function openAdvanced(panel: Page): Promise<void> {
  const advanced = panel.getByRole('button', { name: 'Advanced' });
  if ((await advanced.getAttribute('aria-expanded')) !== 'true') await advanced.click();
}

export interface PaginationLimits {
  maxPages?: number;
  delayMs?: number;
  maxScrolls?: number;
  scrollDelayMs?: number;
  maxRecords?: number;
  nextButtonSelector?: string;
}

/** Fills limits under Advanced. Waits are typed in seconds, as the panel shows them. */
export async function setLimits(panel: Page, limits: PaginationLimits): Promise<void> {
  await openAdvanced(panel);
  if (limits.maxPages !== undefined) await panel.getByLabel('Most pages').fill(String(limits.maxPages));
  if (limits.delayMs !== undefined) {
    await panel.getByLabel('Wait between pages (seconds)').fill(String(limits.delayMs / 1000));
  }
  if (limits.maxScrolls !== undefined) await panel.getByLabel('Most scrolls').fill(String(limits.maxScrolls));
  if (limits.scrollDelayMs !== undefined) {
    await panel.getByLabel('Wait between scrolls (seconds)').fill(String(limits.scrollDelayMs / 1000));
  }
  if (limits.maxRecords !== undefined) await panel.getByLabel('Stop after this many rows').fill(String(limits.maxRecords));
  if (limits.nextButtonSelector !== undefined) {
    await panel.getByLabel('Next button selector (optional)').fill(limits.nextButtonSelector);
  }
}

/** Reads a limit back, in the unit the contract stores (milliseconds for waits). */
export async function readLimit(panel: Page, limit: 'maxPages' | 'maxScrolls'): Promise<string> {
  await openAdvanced(panel);
  return panel.getByLabel(limit === 'maxPages' ? 'Most pages' : 'Most scrolls').inputValue();
}

/** The URL template field, after choosing "Page numbers in the URL". */
export async function setUrlTemplate(panel: Page, template: string): Promise<void> {
  await choosePagination(panel, 'url_template');
  await panel.getByLabel('Page address').fill(template);
}

/** Run screen and recovery copy. */
export const RUN = {
  running: 'Collecting rows…',
  paused: 'Extraction paused',
  cancel: 'Cancel job',
  finish: /Finish and view rows/,
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

/** "N similar items found" on the result card. */
export const itemsFound = (panel: Page, count: number) =>
  panel.getByText(`${count} similar ${count === 1 ? 'item' : 'items'} found`).first();

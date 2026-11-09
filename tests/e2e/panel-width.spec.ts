import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { expect, test } from './release-test';
import { goToPagination, markTourSeen, resultHeading, reviewFieldsHeading, startExtraction, startWith, useThisList } from './helpers/panel';

/**
 * Chrome's side panel opens at about 360 CSS pixels and can be narrowed to 320. The other specs
 * open the panel as a 1280-pixel tab, so a screen that is too wide for the real panel passes
 * there and is clipped for every user. This spec opens it at 320 and checks each main screen.
 */
const EXTENSION_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.output/chrome-mv3-test');
const FIXTURES = 'http://127.0.0.1:3456';
const PANEL_WIDTH = 320;

/**
 * How far the page is wider than the panel, and what sticks out. An element must end inside the
 * panel and inside the content box of its nearest padded container (12px or more, the panel's
 * spacing), or its border and text touch the edge. Only a box that really scrolls sideways, such
 * as the data grid, may hold wider content.
 */
async function overflow(panel: Page): Promise<{ extra: number; offenders: string[] }> {
  return panel.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const scrollsSideways = (element: HTMLElement) =>
      ['auto', 'scroll'].includes(getComputedStyle(element).overflowX) && element.scrollWidth > element.clientWidth;
    const offenders: string[] = [];
    for (const element of document.body.querySelectorAll<HTMLElement>('*')) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const position = getComputedStyle(element).position;
      if (position === 'absolute' || position === 'fixed') continue;

      // <main> scrolls up and down; wider content there is always a bug, so only scrollers inside it count.
      let insideScroller = false;
      for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        if (parent.tagName === 'MAIN') break;
        if (scrollsSideways(parent)) {
          insideScroller = true;
          break;
        }
      }
      if (insideScroller) continue;

      let limit = width;
      for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const padding = parseFloat(getComputedStyle(parent).paddingRight);
        if (padding >= 12) {
          limit = Math.min(width, parent.getBoundingClientRect().right - padding);
          break;
        }
      }
      if (box.right > limit + 1) {
        const name = element.getAttribute('aria-label') ?? (element.textContent ?? '').trim().slice(0, 40);
        offenders.push(`${element.tagName.toLowerCase()} "${name}" ends at ${Math.round(box.right)}px, limit ${Math.round(limit)}px`);
      }
    }
    return { extra: document.documentElement.scrollWidth - width, offenders: offenders.slice(0, 10) };
  });
}

async function expectFits(panel: Page, screen: string): Promise<void> {
  const result = await overflow(panel);
  expect(result, `${screen} is wider than a ${PANEL_WIDTH}px side panel`).toEqual({ extra: 0, offenders: [] });
}

test.describe(`Side panel at ${PANEL_WIDTH}px`, () => {
  test.describe.configure({ mode: 'serial' });

  let context: BrowserContext;
  let extensionId: string;
  let profile: string;

  test.beforeAll(async () => {
    profile = await fs.mkdtemp(path.join(os.tmpdir(), 'pageharvest-width-profile-'));
    context = await chromium.launchPersistentContext(profile, {
      headless: false,
      viewport: { width: PANEL_WIDTH, height: 800 },
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15000 }));
    await markTourSeen(worker);
    extensionId = worker.url().split('/')[2];
  });

  test.afterAll(async () => {
    await context?.close();
    await fs.rm(profile, { recursive: true, force: true }).catch(() => undefined);
  });

  test('every step of a first extraction fits, with nothing cut off', async () => {
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    const target = await context.newPage();
    await target.goto(`${FIXTURES}/twenty-cards.html`);
    await target.bringToFront();

    await expect(panel.getByRole('button', { name: 'Help', exact: true })).toBeVisible({ timeout: 10000 });
    await expectFits(panel, 'The start screen');

    await startWith(panel, 'auto');
    await expect(resultHeading(panel)).toBeVisible({ timeout: 20000 });
    await expectFits(panel, 'The detected list');

    await useThisList(panel).click();
    await expect(reviewFieldsHeading(panel)).toBeVisible({ timeout: 10000 });
    await expectFits(panel, 'Review fields');

    await goToPagination(panel);
    await panel.getByRole('button', { name: 'Advanced' }).click();
    await expectFits(panel, 'Pagination');

    await startExtraction(panel).click();
    await expect(panel.getByRole('button', { name: 'Export', exact: true })).toBeVisible({ timeout: 30000 });
    await expectFits(panel, 'The results');

    await panel.getByRole('button', { name: 'Export', exact: true }).click();
    await expect(panel.getByRole('dialog', { name: 'Export data' })).toBeVisible();
    await expectFits(panel, 'The export dialog');
    await panel.keyboard.press('Escape');
  });

  test('Help, Settings and Datasets fit', async () => {
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    await panel.getByRole('button', { name: 'Help', exact: true }).click();
    await expect(panel.getByRole('searchbox').or(panel.getByRole('textbox')).first()).toBeVisible({ timeout: 10000 });
    await expectFits(panel, 'Help');
    await panel.keyboard.press('Escape');

    await panel.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Save Preferences' })).toBeVisible({ timeout: 10000 });
    await expectFits(panel, 'Settings');

    await panel.getByRole('button', { name: 'Datasets', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Datasets', exact: true })).toHaveAttribute('aria-current', 'page');
    await expectFits(panel, 'Datasets');
  });
});

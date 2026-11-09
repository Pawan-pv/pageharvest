import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext, type Worker } from '@playwright/test';
import { expect, test } from './release-test';
import { GUIDE_STORAGE_KEY } from '../../src/components/guide/preferences';

/**
 * The only spec that does not pre-mark the tour: a fresh profile must show the welcome tour
 * on first open, remember a finish in chrome.storage.local, and not show it again.
 */
const EXTENSION_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.output/chrome-mv3-test');

test.describe('First-run tour', () => {
  test.describe.configure({ mode: 'serial' });

  let context: BrowserContext;
  let worker: Worker;
  let extensionId: string;
  let profile: string;

  test.beforeAll(async () => {
    profile = await fs.mkdtemp(path.join(os.tmpdir(), 'pageharvest-tour-profile-'));
    context = await chromium.launchPersistentContext(profile, {
      headless: false,
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    });
    worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15000 }));
    extensionId = worker.url().split('/')[2];
  });

  test.afterAll(async () => {
    await context?.close();
    await fs.rm(profile, { recursive: true, force: true }).catch(() => undefined);
  });

  test('a fresh profile has no tour flag stored', async () => {
    const stored = await worker.evaluate(async (key) => (await chrome.storage.local.get(key))[key] ?? null, GUIDE_STORAGE_KEY);
    expect(stored).toBeNull();
  });

  test('shows the tour on first open, walks all five steps, and remembers it', async () => {
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    const tour = panel.getByRole('dialog', { name: 'Welcome to PageHarvest' });
    await expect(tour).toBeVisible({ timeout: 10000 });
    await expect(tour).toContainText('Step 1 of 5');
    await expect(panel.getByRole('button', { name: 'Next' })).toBeFocused();

    for (let step = 2; step <= 5; step += 1) {
      await panel.getByRole('button', { name: 'Next' }).click();
      await expect(panel.getByRole('dialog')).toContainText(`Step ${step} of 5`);
    }
    await expect(panel.getByRole('dialog', { name: 'Your data stays on your computer' })).toBeVisible();
    await panel.getByRole('button', { name: 'Get started' }).click();
    await expect(panel.getByRole('dialog')).toHaveCount(0);
    await expect(panel.getByText('Get data from this page')).toBeVisible();

    await expect
      .poll(async () =>
        worker.evaluate(async (key) => (await chrome.storage.local.get(key))[key] ?? null, GUIDE_STORAGE_KEY)
      )
      .toMatchObject({ version: 1, onboardingDone: true });
    await panel.close();
  });

  test('does not show the tour again, and Help reopens it', async () => {
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(panel.getByText('Get data from this page')).toBeVisible({ timeout: 10000 });
    // Give the stored preference time to be read before checking the tour stayed closed.
    await panel.waitForTimeout(500);
    await expect(panel.getByRole('dialog')).toHaveCount(0);

    await panel.getByRole('button', { name: 'Help', exact: true }).click();
    await expect(panel.getByRole('heading', { name: 'Help and guide' })).toBeVisible();
    await panel.getByRole('button', { name: 'Show the welcome tour again' }).click();
    await expect(panel.getByRole('dialog', { name: 'Welcome to PageHarvest' })).toBeVisible();
    await panel.keyboard.press('Escape');
    await expect(panel.getByRole('dialog')).toHaveCount(0);
    await panel.close();
  });
});

/* global chrome */
/**
 * Makes the Chrome Web Store screenshots from the built extension doing real work.
 *
 *   pnpm build && node scripts/generate-screenshots.mjs
 *
 * It loads `.output/chrome-mv3` into Chromium, opens the local Indie Gear store showcase
 * fixture (tests/fixtures/pages/store-showcase.html), and captures the OLED sidepanel
 * and Full-Tab Workbench (table.html).
 *
 * All screenshots are validated at exact store dimensions: 1280x800, deviceScaleFactor 1.
 */
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = join(root, 'store-assets');
const extensionPath = join(root, '.output', 'chrome-mv3');
const SITE = 'http://127.0.0.1:3456/store-showcase.html';
const WIDTH = 1280;
const HEIGHT = 800;
const PANEL_WIDTH = 380;
const PROMO = { width: 440, height: 280 };

/** Width and height from a PNG's header. */
async function pngSize(file) {
  const header = await readFile(file);
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

async function expectSize(file, width, height) {
  const size = await pngSize(file);
  if (size.width !== width || size.height !== height) {
    throw new Error(`${file} is ${size.width}x${size.height}; the store needs exactly ${width}x${height}.`);
  }
}

/** The small promo tile: the icon, the name and what the extension does, in OLED styling. */
async function promoTile(frame) {
  const icon = (await readFile(join(root, 'public', 'icon', '128.png'))).toString('base64');
  await frame.setViewportSize(PROMO);
  await frame.setContent(
    `<body style="margin:0;width:${PROMO.width}px;height:${PROMO.height}px;display:flex;flex-direction:column;
                  align-items:center;justify-content:center;gap:12px;background:#000000;
                  font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#ffffff">
       <div style="display:flex;align-items:center;gap:14px">
         <img src="data:image/png;base64,${icon}" width="56" height="56" alt="" style="filter:drop-shadow(0 0 16px rgba(16,185,129,0.4))">
         <div style="display:flex;flex-direction:column">
           <span style="font-size:32px;font-weight:800;letter-spacing:-0.5px;color:#f8fafc">PageHarvest</span>
           <span style="font-size:12px;font-weight:600;color:#10b981;letter-spacing:1px;text-transform:uppercase">10-Tool Web Extractor</span>
         </div>
       </div>
       <div style="font-size:14px;color:#94a3b8;font-weight:500">100% Local-First • Zero Cloud Servers • Local IndexedDB</div>
       <div style="margin-top:4px;padding:5px 14px;border-radius:999px;border:1px solid rgba(16,185,129,0.3);background:rgba(16,185,129,0.12);color:#34d399;
                   font-size:12px;font-weight:600">Private • Fast • Spreadsheets</div>
     </body>`
  );
  const file = join(outputDir, 'promo-440x280.png');
  await frame.screenshot({ path: file, type: 'png' });
  await expectSize(file, PROMO.width, PROMO.height);
  console.log(`Saved ${file}`);
}

async function ensureFixtureServer() {
  try {
    const res = await fetch('http://127.0.0.1:3456/store-showcase.html');
    if (res.ok) return null;
  } catch {
    // Need to start server
  }

  const serverProc = spawn('node', ['tests/fixtures/serve.cjs'], {
    cwd: root,
    stdio: 'ignore',
  });

  // Wait for server to respond
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      const res = await fetch('http://127.0.0.1:3456/store-showcase.html');
      if (res.ok) {
        return serverProc;
      }
    } catch {
      // Keep waiting
    }
  }
  return serverProc;
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  // Clean earlier screenshots
  for (const name of await readdir(outputDir)) {
    if (/^screenshot-.*\.png$/.test(name)) await rm(join(outputDir, name));
  }

  const serverProc = await ensureFixtureServer();
  const profile = await mkdtemp(join(os.tmpdir(), 'pageharvest-screenshots-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    deviceScaleFactor: 1,
    viewport: { width: WIDTH - PANEL_WIDTH, height: HEIGHT },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 20000 }));
    const extensionId = worker.url().split('/')[2];

    // Seed guide & consent so ToolHub is shown cleanly
    await worker.evaluate(() => {
      chrome.storage.local.set({
        'pageharvest.guide': { version: 1, onboardingDone: true },
        'pageharvest.consent': { accepted: true, version: '1.0', acceptedAt: new Date().toISOString() },
        'pageharvest.advanced': { version: 1, advanced: true },
      });
    });

    const frame = await context.newPage();
    await frame.setViewportSize({ width: WIDTH, height: HEIGHT });

    const page = await context.newPage();
    await page.setViewportSize({ width: WIDTH - PANEL_WIDTH, height: HEIGHT });
    await page.goto(SITE, { waitUntil: 'load' });

    const panel = await context.newPage();
    await panel.setViewportSize({ width: PANEL_WIDTH, height: HEIGHT });
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await page.bringToFront();

    let count = 0;
    const captureDuo = async (name) => {
      count += 1;
      const [site, side] = await Promise.all([
        page.screenshot({ type: 'png' }),
        panel.screenshot({ type: 'png' }),
      ]);
      const image = (buffer) => `data:image/png;base64,${buffer.toString('base64')}`;
      await frame.setContent(
        `<body style="margin:0;display:flex;width:${WIDTH}px;height:${HEIGHT}px;background:#000">
           <img src="${image(site)}" style="width:${WIDTH - PANEL_WIDTH}px;height:${HEIGHT}px">
           <img src="${image(side)}" style="width:${PANEL_WIDTH}px;height:${HEIGHT}px;box-shadow:-2px 0 10px rgba(0,0,0,0.5)">
         </body>`
      );
      const file = join(outputDir, `screenshot-${count}-${name}.png`);
      await frame.screenshot({ path: file, type: 'png' });
      await expectSize(file, WIDTH, HEIGHT);
      await page.bringToFront();
      console.log(`Saved ${file}`);
    };

    // 1. OLED ToolHub: 10 live tools & active page context
    const listBtn = panel.getByRole('button', { name: /List Extractor|Find Data on This Page/i });
    await listBtn.waitFor({ state: 'visible', timeout: 30000 });
    await captureDuo('oled-toolhub');

    // 2. State A: Two-Step Setup (ListSetupView) with detected items & unlocked pagination
    await listBtn.click();
    const autoDetectBtn = panel.getByRole('button', { name: /Auto-detect on this page/i });
    await autoDetectBtn.waitFor({ state: 'visible', timeout: 15000 });
    await autoDetectBtn.click();
    await panel.getByText(/Found \d+ items/i).waitFor({ timeout: 30000 });
    await panel.getByText('② Load More Items').waitFor({ timeout: 15000 });
    await captureDuo('emerald-pulse-setup');

    // 3. State B: Focus Picker Mode Takeover (PickerFocusView)
    const repickBtn = panel.getByRole('button', { name: /Re-pick/i });
    await repickBtn.click();
    await panel.getByText('Select a List Item').waitFor({ timeout: 15000 });
    await panel.getByText(/Hover/i).first().waitFor({ timeout: 15000 });
    await panel.waitForTimeout(250);
    await captureDuo('focus-picker-mode');

    // Exit picker mode back to setup
    await panel.keyboard.press('Escape');
    await panel.getByRole('button', { name: 'Start Extraction' }).waitFor({ timeout: 15000 });
    await panel.getByText(/Found \d+ items · [1-9]\d* columns/i).waitFor({ timeout: 15000 });

    // 4. State D: Extraction Complete Stage (ListCompleteView) with checkmark & text preview
    await panel.getByRole('button', { name: 'Start Extraction' }).click();
    await panel.getByText('Extraction complete').waitFor({ timeout: 60000 });
    await panel.getByRole('button', { name: /View data & export/i }).waitFor({ timeout: 15000 });
    await panel.waitForTimeout(500);
    await captureDuo('extraction-complete');

    // 5. Full-Tab Workbench (table.html) at 1280x800
    count += 1;
    const tablePage = await context.newPage();
    await tablePage.setViewportSize({ width: WIDTH, height: HEIGHT });
    await tablePage.goto(`chrome-extension://${extensionId}/table.html`);
    await tablePage.locator('#root').waitFor({ timeout: 15000 });
    await tablePage.getByRole('heading', { name: 'PageHarvest workbench' }).waitFor({ timeout: 15000 });
    await tablePage.waitForTimeout(1000); // Allow TanStack table render to settle

    const tableFile = join(outputDir, `screenshot-${count}-fulltab-workbench.png`);
    await tablePage.screenshot({ path: tableFile, type: 'png' });
    await expectSize(tableFile, WIDTH, HEIGHT);
    console.log(`Saved ${tableFile}`);
    await tablePage.close();

    // Promo tile
    await promoTile(frame);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true }).catch(() => undefined);
    if (serverProc) {
      serverProc.kill();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

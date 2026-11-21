/* global chrome */
/**
 * Makes the Chrome Web Store screenshots from the built extension doing real work.
 *
 *   pnpm build && node scripts/generate-screenshots.mjs
 *
 * It loads `.output/chrome-mv3` into Chromium, opens a public practice site made for this
 * purpose (books.toscrape.com), and walks the simple flow a new user gets: find the list,
 * check the columns, collect, download. Nothing is seeded or mocked: every row in a
 * screenshot was collected from the page beside it during this run.
 *
 * Playwright cannot capture Chrome's side panel, so the panel is opened as a tab of the same
 * width, and each screenshot is the page and the panel captured at the same moment and set
 * side by side, the way Chrome docks them.
 *
 * The store accepts only exact sizes: 1280x800 for a screenshot and 440x280 for the small
 * promo tile. The device scale factor is fixed at 1, so a display set to 125% cannot change
 * them, and every file's size is read back and checked before the script reports success.
 */
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = join(root, 'store-assets');
const extensionPath = join(root, '.output', 'chrome-mv3');
const SITE = 'https://books.toscrape.com/';
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

/** The small promo tile: the icon, the name and what the extension does, in its own colours. */
async function promoTile(frame) {
  const icon = (await readFile(join(root, 'public', 'icon', '128.png'))).toString('base64');
  await frame.setViewportSize(PROMO);
  await frame.setContent(
    `<body style="margin:0;width:${PROMO.width}px;height:${PROMO.height}px;display:flex;flex-direction:column;
                  align-items:center;justify-content:center;gap:10px;background:linear-gradient(160deg,#064e3b,#047857);
                  font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#fff">
       <div style="display:flex;align-items:center;gap:12px">
         <img src="data:image/png;base64,${icon}" width="56" height="56" alt="">
         <span style="font-size:38px;font-weight:700;letter-spacing:-0.5px">PageHarvest</span>
       </div>
       <div style="font-size:17px;opacity:.95">Lists on web pages, into a spreadsheet</div>
       <div style="margin-top:6px;padding:6px 14px;border-radius:999px;background:#ecfdf5;color:#064e3b;
                   font-size:13px;font-weight:600">Stays on your computer</div>
     </body>`
  );
  const file = join(outputDir, 'promo-440x280.png');
  await frame.screenshot({ path: file, type: 'png' });
  await expectSize(file, PROMO.width, PROMO.height);
  console.log(`Saved ${file}`);
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  // Screenshots from an earlier run would be mistaken for this build's.
  for (const name of await readdir(outputDir)) {
    if (/^screenshot-.*\.png$/.test(name)) await rm(join(outputDir, name));
  }
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
    // The welcome tour would cover the first screenshot.
    await worker.evaluate(() => chrome.storage.local.set({ 'pageharvest.guide': { version: 1, onboardingDone: true } }));

    // The page the two captures are set side by side on. It is opened first, because the
    // panel works on whichever tab is in front, and that must stay the site.
    const frame = await context.newPage();
    await frame.setViewportSize({ width: WIDTH, height: HEIGHT });
    const page = await context.newPage();
    await page.goto(SITE, { waitUntil: 'load' });
    const panel = await context.newPage();
    await panel.setViewportSize({ width: PANEL_WIDTH, height: HEIGHT });
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await page.bringToFront();

    let count = 0;
    /** The page and the panel as they are now, side by side, saved as one 1280x800 image. */
    const capture = async (name) => {
      count += 1;
      const [site, side] = await Promise.all([
        page.screenshot({ type: 'png' }),
        panel.screenshot({ type: 'png' }),
      ]);
      const image = (buffer) => `data:image/png;base64,${buffer.toString('base64')}`;
      await frame.setContent(
        `<body style="margin:0;display:flex;width:${WIDTH}px;height:${HEIGHT}px;background:#fff">
           <img src="${image(site)}" style="width:${WIDTH - PANEL_WIDTH}px;height:${HEIGHT}px">
           <img src="${image(side)}" style="width:${PANEL_WIDTH}px;height:${HEIGHT}px;box-shadow:-1px 0 0 #cbd5e1">
         </body>`
      );
      const file = join(outputDir, `screenshot-${count}-${name}.png`);
      await frame.screenshot({ path: file, type: 'png' });
      await expectSize(file, WIDTH, HEIGHT);
      await page.bringToFront();
      console.log(`Saved ${file}`);
    };

    // Enabled means the panel has seen the site and can read it.
    await panel.locator('button:not([disabled])', { hasText: /Find Data on This Page|Get the list on this page/i }).waitFor({ timeout: 30000 });
    await capture('start');

    await panel.getByRole('button', { name: /Find Data on This Page|Get the list on this page/i }).click();
    await panel.getByRole('heading', { name: /^We found \d+ items on this page$/ }).waitFor({ timeout: 30000 });
    await panel.getByRole('table', { name: 'The first rows' }).waitFor({ timeout: 15000 });
    await capture('found-the-list');

    await panel.getByRole('button', { name: 'Yes, this is my list' }).click();
    await panel.getByRole('heading', { name: 'Check your columns' }).waitFor();
    await panel.getByRole('checkbox', { name: /^Keep the column / }).first().waitFor({ timeout: 15000 });
    // Two pages are enough for a picture, and gentle on the practice site.
    const pages = panel.getByRole('spinbutton', { name: 'Stop after this many pages:' });
    if (await pages.count()) await pages.fill('2');
    await capture('check-the-columns');

    await panel.getByRole('button', { name: 'Start collecting' }).click();
    await panel.getByRole('heading', { name: /^Done\. .+ collected$/ }).waitFor({ timeout: 120000 });
    // The download itself is not pictured: an automated browser saves files under a made-up
    // name, which is not the name a person's Chrome would show.
    await panel.getByRole('button', { name: 'Download for Excel' }).waitFor();
    await capture('done');

    await panel.getByRole('button', { name: 'See and change all rows' }).click();
    await panel.getByRole('textbox', { name: 'Search these rows' }).waitFor();
    await capture('all-rows');

    await promoTile(frame);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/**
 * Renders the PageHarvest extension icons with Chromium from original SVG artwork.
 *
 *   node scripts/generate-icons.mjs
 *
 * The mark is a wheat ear on an emerald tile, matching the side panel header. Small
 * sizes use a simplified ear, because fine grains blur together below 32 pixels.
 * Chrome Web Store guidance for the 128px icon is 96x96 artwork with 16px of transparent
 * padding, which `padding` below follows.
 */
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = join(root, 'public/icon');

function grains(count, spacing, rx, ry, angle) {
  let out = '';
  for (let i = 0; i < count; i++) {
    const y = 66 - i * spacing;
    out += `<ellipse cx="-${rx * 1.05}" cy="${y}" rx="${rx}" ry="${ry}" transform="rotate(-${angle} -${rx * 1.05} ${y})"/>`;
    out += `<ellipse cx="${rx * 1.05}" cy="${y}" rx="${rx}" ry="${ry}" transform="rotate(${angle} ${rx * 1.05} ${y})"/>`;
  }
  return out;
}

function artwork({ grainCount, spacing, rx, ry, angle, stem, padding, radius }) {
  const tile = 128 - padding * 2;
  const scale = tile / 128;
  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#10b981"/>
      <stop offset="1" stop-color="#047857"/>
    </linearGradient>
  </defs>
  <g transform="translate(${padding} ${padding}) scale(${scale})">
    <rect width="128" height="128" rx="${radius}" fill="url(#tile)"/>
    <g transform="translate(64 16)" fill="#fef3c7">
      <rect x="${-stem / 2}" y="18" width="${stem}" height="82" rx="${stem / 2}"/>
      ${grains(grainCount, spacing, rx, ry, angle)}
      <ellipse cx="0" cy="${66 - grainCount * spacing + 2}" rx="${ry}" ry="${rx}"/>
    </g>
  </g>
</svg>`;
}

// Each size has its own artwork so it stays legible at that size.
const SIZES = [
  { size: 16, grainCount: 2, spacing: 25, rx: 15, ry: 9, angle: 34, stem: 11, padding: 0, radius: 26 },
  { size: 32, grainCount: 3, spacing: 19, rx: 13, ry: 7.5, angle: 34, stem: 8, padding: 0, radius: 26 },
  { size: 48, grainCount: 4, spacing: 15, rx: 12, ry: 6.5, angle: 34, stem: 6.5, padding: 6, radius: 24 },
  { size: 128, grainCount: 4, spacing: 15, rx: 12, ry: 6.25, angle: 34, stem: 5, padding: 16, radius: 24 },
];

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch();
try {
  for (const { size, ...options } of SIZES) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent">
        <div style="width:${size}px;height:${size}px">${artwork(options).replace(
          'width="128" height="128"',
          `width="${size}" height="${size}"`
        )}</div>
      </body></html>`
    );
    await page.screenshot({
      path: join(outputDir, `${size}.png`),
      omitBackground: true,
      clip: { x: 0, y: 0, width: size, height: size },
    });
    await page.close();
    console.log(`Wrote public/icon/${size}.png`);
  }
} finally {
  await browser.close();
}

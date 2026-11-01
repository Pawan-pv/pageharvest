import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const SIZES = [16, 32, 48, 128] as const;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function readIcon(size: number): Buffer {
  return readFileSync(resolve(ROOT, `public/icon/${size}.png`));
}

describe('Extension icon assets', () => {
  it.each(SIZES)('ships a real %ipx PNG with matching dimensions', (size) => {
    const path = resolve(ROOT, `public/icon/${size}.png`);
    expect(existsSync(path)).toBe(true);

    const buffer = readIcon(size);
    expect(Array.from(buffer.subarray(0, 8))).toEqual(PNG_SIGNATURE);
    expect(buffer.toString('ascii', 12, 16)).toBe('IHDR');
    expect(buffer.readUInt32BE(16)).toBe(size);
    expect(buffer.readUInt32BE(20)).toBe(size);
    // A placeholder of a flat color compresses to almost nothing.
    expect(buffer.length).toBeGreaterThan(size === 16 ? 200 : 400);
  });

  it('uses distinct artwork per size rather than one stretched file', () => {
    const contents = new Set(SIZES.map((size) => readIcon(size).toString('base64')));
    expect(contents.size).toBe(SIZES.length);
  });

  it('declares icons and the toolbar icon in the manifest configuration', () => {
    const config = readFileSync(resolve(ROOT, 'wxt.config.ts'), 'utf8');

    for (const size of SIZES) {
      expect(config).toContain(`${size}: 'icon/${size}.png'`);
    }
    expect(config).toMatch(/action:\s*{[^}]*default_icon/s);
  });

  it('declares the minimum Chrome version that supports the side panel', () => {
    const config = readFileSync(resolve(ROOT, 'wxt.config.ts'), 'utf8');
    expect(config).toContain("minimum_chrome_version: '116'");
  });
});

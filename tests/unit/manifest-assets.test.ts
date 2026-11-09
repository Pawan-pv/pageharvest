import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REQUIRED_PERMISSIONS } from '@/platform/permissions';

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

describe('Manifest permissions', () => {
  function declaredPermissions(): string[] {
    const config = readFileSync(resolve(ROOT, 'wxt.config.ts'), 'utf8');
    const list = config.match(/permissions:\s*\[([^\]]*)\]/s)?.[1] ?? '';
    return [...list.matchAll(/'([^']+)'/g)].map((match) => match[1] ?? '').sort();
  }

  function builtManifest(): Record<string, unknown> {
    const raw = readFileSync(resolve(ROOT, '.output/chrome-mv3/manifest.json'), 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
  }

  function builtManifestRaw(): string | null {
    try {
      return readFileSync(resolve(ROOT, '.output/chrome-mv3/manifest.json'), 'utf8');
    } catch {
      return null;
    }
  }

  it('requests exactly the permissions the job start check requires', () => {
    expect(declaredPermissions()).toEqual([...REQUIRED_PERMISSIONS].sort());
  });

  it('requests scripting for on-demand injection (ADR-037)', () => {
    expect(declaredPermissions()).toContain('scripting');
  });

  it('built manifest has no static content scripts and no broad host warning (ADR-037)', () => {
    // CI's unit layer runs `pnpm test` before `pnpm build`; when no build output
    // exists yet, verify the same contract from source and skip the built-file
    // assertions (the e2e/release layers build first and get the strict check).
    if (!existsSync(resolve(ROOT, '.output/chrome-mv3/manifest.json'))) {
      const config = readFileSync(resolve(ROOT, 'wxt.config.ts'), 'utf8');
      expect(config).toContain('optional_host_permissions');
      expect(config).not.toContain('<all_urls>');
      expect(readFileSync(resolve(ROOT, 'entrypoints/content.ts'), 'utf8')).toContain("registration: 'runtime'");
      return;
    }
    const raw = builtManifestRaw()!;
    const manifest = builtManifest();
    // WXT emits "content_scripts": [] for runtime-registered scripts; either
    // absent or empty counts, but no <all_urls> entry may exist anywhere.
    const contentScripts = manifest['content_scripts'] as unknown[] | undefined;
    expect(contentScripts === undefined || contentScripts.length === 0).toBe(true);
    expect(raw).not.toContain('<all_urls>');
    expect('host_permissions' in manifest).toBe(false);
    expect(manifest['optional_host_permissions']).toEqual(['http://*/*', 'https://*/*']);
    expect([...(manifest['permissions'] as string[])].sort()).toEqual(
      ['activeTab', 'downloads', 'scripting', 'sidePanel', 'storage'].sort()
    );
  });
});

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

  it('holds site access from install, so no site is ever asked for while in use (ADR-040)', () => {
    const config = readFileSync(resolve(ROOT, 'wxt.config.ts'), 'utf8');
    expect(config).toMatch(/[^_]host_permissions:\s*\['http:\/\/\*\/\*',\s*'https:\/\/\*\/\*'\]/);
    expect(config).not.toContain('optional_host_permissions');
  });

  it('justifies every permission in the privacy policy and the store listing', () => {
    const privacy = readFileSync(resolve(ROOT, 'PRIVACY.md'), 'utf8');
    const listing = readFileSync(resolve(ROOT, 'docs/STORE_LISTING.md'), 'utf8');
    // A table row that starts with the permission's name and gives a reason after it.
    const hasRow = (text: string, permission: string) =>
      text.split(/\r?\n/).some((line) => line.startsWith(`| \`${permission}\` | `) && line.length > permission.length + 40);
    for (const permission of REQUIRED_PERMISSIONS) {
      expect(hasRow(privacy, permission), `PRIVACY.md has no row for ${permission}`).toBe(true);
      expect(hasRow(listing, permission), `STORE_LISTING.md has no row for ${permission}`).toBe(true);
    }
    // Site access is a host permission held from install (ADR-040): named in both, never called optional.
    for (const text of [privacy, listing]) {
      expect(text).toContain('http://*/*');
      expect(text).toContain('https://*/*');
      expect(text).not.toMatch(/asked at use|one site at a time/i);
    }
  });

  it('describes on-demand injection in the privacy policy, not a script that runs on every page', () => {
    const privacy = readFileSync(resolve(ROOT, 'PRIVACY.md'), 'utf8');
    expect(privacy).not.toMatch(/page script runs on the pages you visit/i);
    expect(privacy).toMatch(/does not run on pages you have not started it on/i);
    expect(privacy).toMatch(/Limited Use/);
  });

  it('built manifest has no static content scripts and grants http and https sites (ADR-037, ADR-040)', () => {
    // CI's unit layer runs `pnpm test` before `pnpm build`; when no build output
    // exists yet, verify the same contract from source and skip the built-file
    // assertions (the e2e/release layers build first and get the strict check).
    if (!existsSync(resolve(ROOT, '.output/chrome-mv3/manifest.json'))) {
      const config = readFileSync(resolve(ROOT, 'wxt.config.ts'), 'utf8');
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
    expect(manifest['host_permissions']).toEqual(['http://*/*', 'https://*/*']);
    expect('optional_host_permissions' in manifest).toBe(false);
    expect([...(manifest['permissions'] as string[])].sort()).toEqual(
      ['activeTab', 'downloads', 'scripting', 'sidePanel', 'storage'].sort()
    );
  });
});

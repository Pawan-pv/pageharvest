import { readFileSync, readdirSync, existsSync } from 'node:fs';
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

describe('Chrome Web Store assets', () => {
  const ASSETS = resolve(ROOT, 'store-assets');
  const pngSize = (file: string) => {
    const buffer = readFileSync(resolve(ASSETS, file));
    expect(Array.from(buffer.subarray(0, 8)), file).toEqual(PNG_SIGNATURE);
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  };
  const screenshots = () => readdirSync(ASSETS).filter((name) => /^screenshot.*\.png$/.test(name));

  // The store's upload form refuses any other size, whatever the file is called.
  it('has a small promo tile of exactly 440x280', () => {
    expect(pngSize('promo-440x280.png')).toEqual({ width: 440, height: 280 });
  });

  it('has one to five screenshots, each exactly 1280x800', () => {
    const files = screenshots();
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files.length).toBeLessThanOrEqual(5);
    for (const file of files) {
      expect(pngSize(file), file).toEqual({ width: 1280, height: 800 });
    }
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

  it('says in the privacy policy what the job path reads and how fast it goes, as the code does', () => {
    const privacy = readFileSync(resolve(ROOT, 'PRIVACY.md'), 'utf8');
    const pagination = readFileSync(resolve(ROOT, 'src/shared/contracts/pagination.ts'), 'utf8');
    const content = readFileSync(resolve(ROOT, 'src/content/workflow-coordinator.ts'), 'utf8');
    const coordinator = readFileSync(resolve(ROOT, 'src/background/job-coordinator.ts'), 'utf8');
    // The minimum wait between pages (ADR-046).
    expect(pagination).toContain('export const MIN_PAGE_DELAY_MS = 1000;');
    expect(privacy).toMatch(/waiting at least one second between pages/);
    // The page's own status is read, and only to stop on 429 (ADR-045).
    expect(content).toContain('TOO_MANY_REQUESTS = 429');
    expect(privacy).toMatch(/Too Many Requests/);
    // The found list's tab address, checked at Start (ADR-043).
    expect(coordinator).toContain('getTabUrl');
    expect(privacy).toMatch(/checks with Chrome that the tab still shows the page the list came from/);
    // Every storage area the code uses is named.
    expect(privacy).toContain('chrome.storage.local');
    expect(privacy).toContain('chrome.storage.session');
  });

  it('declares web history in the store answers, because job history keeps page addresses', () => {
    const listing = readFileSync(resolve(ROOT, 'docs/STORE_LISTING.md'), 'utf8');
    expect(listing).toMatch(/^- \*\*Website content\*\*: /m);
    expect(listing).toMatch(/^- \*\*Web history\*\*: .*addresses of the pages the job visited/m);
  });

  it.each(['TERMS_OF_USE.md', 'ACCEPTABLE_USE.md'])('marks %s as a draft for legal review, not in force', (file) => {
    const text = readFileSync(resolve(ROOT, file), 'utf8');
    expect(text).toMatch(/\*\*Draft for legal review\. Not in force\.\*\*/);
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

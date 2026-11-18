import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildNotices, shippedPackages } from '../../scripts/generate-third-party-notices.mjs';

const ROOT = resolve(__dirname, '../..');
const NOTICES = resolve(ROOT, 'public/THIRD_PARTY_NOTICES.txt');

const unix = (text: string) => text.replace(/\r\n/g, '\n');

/**
 * The packaged extension contains other people's code (React, Dexie, Zod and more). Their
 * licences (MIT, Apache-2.0, ISC) all require the copyright notice and licence text to travel
 * with every copy, so the package ships them in one file that Help links to.
 */
describe('Third-party licence notices', () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>;
  };

  it('ships a notices file in the package', () => {
    expect(existsSync(NOTICES)).toBe(true);
  });

  it('covers every runtime dependency, and what those depend on', () => {
    const names = shippedPackages().map((entry) => entry.name);
    for (const dependency of Object.keys(pkg.dependencies)) {
      expect(names, `${dependency} is shipped but has no notice`).toContain(dependency);
    }
    // Pulled in by react-dom and @tanstack/react-table, and bundled with them.
    expect(names).toContain('scheduler');
    expect(names).toContain('@tanstack/table-core');
    // Its base stylesheet is part of the panel's CSS.
    expect(names).toContain('tailwindcss');
  });

  it('gives each package a version, a licence name and the licence text itself', () => {
    for (const entry of shippedPackages()) {
      expect(entry.version, entry.name).toMatch(/^\d+\.\d+\.\d+/);
      expect(entry.license, entry.name).toMatch(/^(MIT|ISC|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|0BSD)$/);
      expect(entry.text.length, `${entry.name} has no licence text`).toBeGreaterThan(300);
      expect(entry.text, entry.name).toMatch(/copyright|permission|licen[cs]e/i);
    }
  });

  it("includes Dexie's NOTICE file, which Apache-2.0 requires to be passed on", () => {
    const dexie = shippedPackages().find((entry) => entry.name === 'dexie');
    expect(dexie?.license).toBe('Apache-2.0');
    expect(dexie?.text).toContain('--- NOTICE ---');
    expect(dexie?.text).toMatch(/Apache License/);
  });

  it('is the file a fresh generation would write, so it cannot go stale', () => {
    expect(unix(readFileSync(NOTICES, 'utf8'))).toBe(buildNotices());
  });

  it('names no licence that restricts shipping in a closed package', () => {
    for (const entry of shippedPackages()) {
      expect(entry.license, entry.name).not.toMatch(/GPL|SSPL|MPL|CC-BY-NC/i);
    }
  });
});

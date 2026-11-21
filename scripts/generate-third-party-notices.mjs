// Writes public/THIRD_PARTY_NOTICES.txt: the copyright notice and licence text of every
// package whose code is inside the packaged extension. MIT, ISC and Apache-2.0 all require
// that text to travel with each copy, and a minified bundle keeps only one-line banners.
//
//   node scripts/generate-third-party-notices.mjs
//
// `pnpm build` and `pnpm zip` run it first, and tests/unit/third-party-notices.test.ts fails
// when the committed file is not what this script would write.
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const NOTICES_PATH = join(ROOT, 'public', 'THIRD_PARTY_NOTICES.txt');

/**
 * Build-time packages that still leave code in the package: Tailwind's base stylesheet is
 * part of the panel's CSS, and WXT's entrypoint helpers are bundled into each script. Their
 * own dependencies are build tools and are not shipped, so they are not followed.
 */
const SHIPPED_BUILD_PACKAGES = ['tailwindcss', 'vite', 'wxt'];

const LICENCE_FILE = /^(licen[cs]e|copying)(\.(md|txt|markdown))?$/i;
const NOTICE_FILE = /^notice(\.(md|txt))?$/i;

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** The folder a package's dependencies are resolved from: the last node_modules above it. */
function siblingsOf(packageDir) {
  const parts = packageDir.split(sep);
  const index = parts.lastIndexOf('node_modules');
  return index === -1 ? null : parts.slice(0, index + 1).join(sep);
}

function locate(name, from) {
  const candidates = [from && join(from, name), join(ROOT, 'node_modules', name)].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
  }
  throw new Error(`Cannot find the installed package "${name}". Run pnpm install first.`);
}

/** The licence text, followed by the package's NOTICE file when it has one (Apache-2.0, 4d). */
function licenceText(packageDir, name) {
  const entries = readdirSync(packageDir);
  const file = entries.find((entry) => LICENCE_FILE.test(entry));
  if (!file) throw new Error(`"${name}" ships no licence file; add its text by hand before releasing.`);
  const read = (entry) => readFileSync(join(packageDir, entry), 'utf8').replace(/\r\n/g, '\n').trim();
  const notice = entries.find((entry) => NOTICE_FILE.test(entry));
  return notice ? `${read(file)}\n\n--- NOTICE ---\n\n${read(notice)}` : read(file);
}

function repositoryOf(manifest) {
  const repository = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
  const address = manifest.homepage || repository || '';
  return address.replace(/^git\+/, '').replace(/\.git$/, '');
}

/** Every package with code in the extension, sorted by name: { name, version, license, homepage, text }. */
export function shippedPackages() {
  const root = readJson(join(ROOT, 'package.json'));
  const found = new Map();

  const visit = (name, from, follow) => {
    const packageDir = locate(name, from);
    const manifest = readJson(join(packageDir, 'package.json'));
    const key = `${manifest.name}@${manifest.version}`;
    if (found.has(key)) return;
    found.set(key, {
      name: manifest.name,
      version: manifest.version,
      license: typeof manifest.license === 'string' ? manifest.license : String(manifest.license?.type ?? ''),
      homepage: repositoryOf(manifest),
      text: licenceText(packageDir, manifest.name),
    });
    if (!follow) return;
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      visit(dependency, siblingsOf(packageDir), true);
    }
  };

  for (const name of Object.keys(root.dependencies ?? {})) visit(name, null, true);
  for (const name of SHIPPED_BUILD_PACKAGES) visit(name, null, false);

  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en'));
}

export function buildNotices() {
  const packages = shippedPackages();
  const line = '='.repeat(78);
  const head = [
    'PageHarvest: third-party notices',
    '',
    'PageHarvest includes code from the open-source packages below. Each is used under',
    'its own licence, which is reproduced in full after its name.',
    '',
    ...packages.map((entry) => `  ${entry.name} ${entry.version} (${entry.license})`),
    '',
  ];
  const body = packages.flatMap((entry) => [
    line,
    `${entry.name} ${entry.version}`,
    `Licence: ${entry.license}`,
    ...(entry.homepage ? [entry.homepage] : []),
    line,
    '',
    entry.text,
    '',
  ]);
  return `${[...head, ...body].join('\n').trimEnd()}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeFileSync(NOTICES_PATH, buildNotices(), 'utf8');
  console.log(`Wrote ${NOTICES_PATH} (${shippedPackages().length} packages)`);
}

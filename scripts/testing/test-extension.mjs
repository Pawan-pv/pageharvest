// Prepares the copy of the production build that automated browsers load.
//
// Since ADR-040 the production manifest holds http and https site access from install, so
// the copy needs no extra grant: chrome.permissions.request resolves true at once, with no
// permission bubble, for every site a run visits. Automated runs still load a copy, so the
// production build in .output/chrome-mv3 is never the directory a browser profile points
// at, and never modified. `hosts` is added only when the manifest does not already cover
// it (a build that predates ADR-040).
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const PRODUCTION_BUILD = join(ROOT, '.output', 'chrome-mv3');
export const TEST_BUILD = join(ROOT, '.output', 'chrome-mv3-test');
/** The local fixture server (tests/fixtures/serve.cjs). */
export const FIXTURE_HOSTS = ['http://127.0.0.1:3456/*'];

/**
 * Copies the production build to `target` and makes sure the copy's manifest grants
 * `hosts`. Returns the copy's path. Throws when the production build is missing.
 */
export function prepareTestExtension({ hosts = FIXTURE_HOSTS, source = PRODUCTION_BUILD, target = TEST_BUILD } = {}) {
  const manifestPath = join(source, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`The production build is missing: ${source}. Run pnpm build first.`);
  }
  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, { recursive: true });

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const granted = Array.isArray(manifest.host_permissions) ? manifest.host_permissions : [];
  // "http://host/*" is covered by itself or by its scheme's all-sites pattern, "http://*/*".
  const covered = (host) => granted.includes(host) || granted.includes(`${host.split('//')[0]}//*/*`);
  const missing = hosts.filter((host) => !covered(host));
  if (missing.length > 0) {
    manifest.host_permissions = [...granted, ...missing];
    writeFileSync(join(target, 'manifest.json'), JSON.stringify(manifest));
  }
  return target;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hosts = process.argv.slice(2);
  console.log(prepareTestExtension(hosts.length ? { hosts } : {}));
}

// Prepares the copy of the production build that automated browsers load.
//
// Since ADR-037 the extension has no host access at install: it asks for one site at a
// time with chrome.permissions.request, and Chrome answers with a permission bubble that
// Playwright and CDP cannot click. Automated runs therefore load this copy, which is the
// production build byte for byte except that its manifest also grants the sites the run
// visits as `host_permissions`, the state of a user who already allowed those sites.
// chrome.permissions.request then resolves true at once, as Chrome does for any origin
// that is already granted. The prompt itself stays a manual check.
//
// The production build in .output/chrome-mv3 is never modified.
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const PRODUCTION_BUILD = join(ROOT, '.output', 'chrome-mv3');
export const TEST_BUILD = join(ROOT, '.output', 'chrome-mv3-test');
/** The local fixture server (tests/fixtures/serve.cjs). */
export const FIXTURE_HOSTS = ['http://127.0.0.1:3456/*'];

/**
 * Copies the production build to `target` and grants `hosts` in the copy's manifest.
 * Returns the copy's path. Throws when the production build is missing.
 */
export function prepareTestExtension({ hosts = FIXTURE_HOSTS, source = PRODUCTION_BUILD, target = TEST_BUILD } = {}) {
  const manifestPath = join(source, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`The production build is missing: ${source}. Run pnpm build first.`);
  }
  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, { recursive: true });

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.host_permissions) {
    throw new Error('The production manifest must not declare host_permissions (ADR-037).');
  }
  manifest.host_permissions = [...hosts];
  writeFileSync(join(target, 'manifest.json'), JSON.stringify(manifest));
  return target;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hosts = process.argv.slice(2);
  console.log(prepareTestExtension(hosts.length ? { hosts } : {}));
}

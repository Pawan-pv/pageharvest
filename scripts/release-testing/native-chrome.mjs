import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '../..');

export function findChromeExecutable() {
  const candidates = [
    process.env.PROGRAMFILES
      ? join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe')
      : null,
    process.env['PROGRAMFILES(X86)']
      ? join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe')
      : null,
    process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
      : null,
  ].filter((candidate) => candidate !== null);

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export function getChromeVersion(chromePath) {
  if (!chromePath) return null;
  const escapedPath = chromePath.replaceAll("'", "''");
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-Command', `(Get-Item -LiteralPath '${escapedPath}').VersionInfo.ProductVersion`],
    { encoding: 'utf8', windowsHide: true }
  );
  const output = `${result.stdout ?? ''} ${result.stderr ?? ''}`.trim();
  return output.replace(/^Google Chrome\s*/i, '') || null;
}

async function getFreePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : null;
  await new Promise((resolvePromise) => server.close(resolvePromise));
  if (!port) throw new Error('Could not allocate a local DevTools port.');
  return port;
}

async function waitForJson(url, timeoutMs = 10000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  }
  throw new Error(`Timed out waiting for ${url}${lastError ? `: ${lastError.message}` : ''}`);
}

function detectUiAutomationBackends() {
  const backends = [];
  const pythonProbe = spawnSync('python', ['-c', 'import pywinauto'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (pythonProbe.status === 0) backends.push('pywinauto');

  const autoHotkeyProbe = spawnSync('where.exe', ['AutoHotkey.exe'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (autoHotkeyProbe.status === 0) backends.push('AutoHotkey');
  return backends;
}

async function writeJson(filePath, value) {
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

export async function runNativeChromeCheck({
  buildLocation = resolve(repositoryRoot, '.output/chrome-mv3'),
  artifactDirectory = resolve(repositoryRoot, 'artifacts/release-testing/native-chrome'),
  keepArtifacts = process.env.PAGEHARVEST_KEEP_RELEASE_ARTIFACTS === '1',
} = {}) {
  const startedAt = Date.now();
  await mkdir(artifactDirectory, { recursive: true });
  const profileDirectory = join(artifactDirectory, `profile-${Date.now()}`);
  const chromePath = findChromeExecutable();
  const chromeVersion = getChromeVersion(chromePath);
  const manifestPath = join(buildLocation, 'manifest.json');
  const diagnosticsPath = join(artifactDirectory, 'native-chrome-diagnostics.json');
  let browserProcess = null;
  let extensionId = null;
  let status = 'BLOCKED';
  let details = '';
  let targets = [];

  try {
    if (process.platform !== 'win32') {
      details = `Native Chrome UI automation is only configured for Windows; current platform is ${process.platform}.`;
    } else if (!chromePath) {
      details = 'Google Chrome was not found in the standard installation locations.';
    } else if (!existsSync(manifestPath)) {
      status = 'FAIL';
      details = `Production extension build is missing: ${manifestPath}`;
    } else {
      const port = await getFreePort();
      await mkdir(profileDirectory, { recursive: true });
      browserProcess = spawn(chromePath, [
        `--user-data-dir=${profileDirectory}`,
        `--disable-extensions-except=${buildLocation}`,
        `--load-extension=${buildLocation}`,
        `--remote-debugging-port=${port}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-sync',
        '--new-window',
        'http://127.0.0.1:3456/release-products.html',
      ], { stdio: 'ignore', windowsHide: false });

      await waitForJson(`http://127.0.0.1:${port}/json/version`);
      targets = await waitForJson(`http://127.0.0.1:${port}/json/list`);
      const extensionTarget = targets.find((target) =>
        target.type === 'service_worker' &&
        typeof target.url === 'string' &&
        target.url.startsWith('chrome-extension://')
      ) ?? targets.find((target) =>
        target.type === 'background_page' &&
        typeof target.url === 'string' &&
        target.url.startsWith('chrome-extension://')
      );
      extensionId = extensionTarget?.url.match(/^chrome-extension:\/\/([^/]+)/)?.[1] ?? null;

      if (!extensionTarget) {
        status = 'FAIL';
        details = 'Chrome launched, but the unpacked PageHarvest extension did not appear in the DevTools target list.';
      } else {
        const backends = detectUiAutomationBackends();
        if (backends.length === 0) {
        details = [
          `Chrome ${chromeVersion ?? 'unknown'} launched with an isolated profile.`,
          `The unpacked extension loaded${extensionId ? ` as ${extensionId}` : ''}.`,
          'BLOCKED: no supported desktop UI automation backend (pywinauto or AutoHotkey) is installed.',
          'Direct sidepanel.html navigation and chrome.sidePanel.open() are intentionally not used as substitutes.',
        ].join(' ');
        } else {
          details = `BLOCKED: detected ${backends.join(', ')} but no configured PageHarvest toolbar adapter exists for this environment.`;
        }
      }
    }
  } catch (error) {
    status = 'FAIL';
    details = error instanceof Error ? error.message : String(error);
  } finally {
    const diagnostics = {
      chromePath,
      chromeVersion,
      buildLocation,
      extensionId,
      targets: targets.map((target) => ({ type: target.type, url: target.url, title: target.title })),
      profileDirectory,
      status,
      details,
      capturedAt: new Date().toISOString(),
    };
    await writeJson(diagnosticsPath, diagnostics);
    if (browserProcess) {
      if (!browserProcess.killed) browserProcess.kill();
      await new Promise((resolvePromise) => {
        if (browserProcess.exitCode !== null) {
          resolvePromise();
          return;
        }
        const timeout = setTimeout(resolvePromise, 3000);
        browserProcess.once('exit', () => {
          clearTimeout(timeout);
          resolvePromise();
        });
      });
    }
    if (!keepArtifacts) {
      try {
        await rm(profileDirectory, { recursive: true, force: true });
      } catch {
        // A locked profile is retained as a diagnostic artifact instead of
        // turning an otherwise valid BLOCKED result into a cleanup failure.
      }
    }
  }

  const result = {
    name: 'native-chrome',
    status,
    exitCode: status === 'PASS' ? 0 : status === 'BLOCKED' ? 3 : 1,
    durationMs: Date.now() - startedAt,
    details,
    browser: { name: 'Google Chrome', version: chromeVersion ?? 'unknown' },
    extensionId,
    diagnosticsPath,
  };
  await writeJson(join(artifactDirectory, 'native-chrome-result.json'), result);
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const result = await runNativeChromeCheck({
    buildLocation: resolve(repositoryRoot, '.output/chrome-mv3'),
    artifactDirectory: resolve(
      repositoryRoot,
      process.env.PAGEHARVEST_RELEASE_ARTIFACT_DIR ?? 'artifacts/release-testing/native-chrome'
    ),
  });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.exitCode;
}

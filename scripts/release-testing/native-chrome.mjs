/* global WebSocket */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decideNativeStatus } from './release-report.mjs';

/**
 * Proves the part of the product no other test can reach: a person clicks the extension in
 * the real browser toolbar and the real side panel opens and works.
 *
 * The panel is only ever opened by a mouse click on the toolbar (click-toolbar.py). Opening
 * sidepanel.html in a tab or calling chrome.sidePanel.open() would prove nothing, so neither
 * is used. DevTools is only used to observe the result and to press buttons inside the panel.
 */
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '../..');
const toolbarAdapter = join(scriptDirectory, 'click-toolbar.py');

const FIXTURE_ORIGIN = 'http://127.0.0.1:3456';
const FIXTURE_URL = `${FIXTURE_ORIGIN}/twenty-cards.html`;
const EXPECTED_ROWS = 20;
const EXTENSION_NAME = 'PageHarvest';
const STEP_TIMEOUT_MS = 30000;

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

/**
 * Branded Chrome 137 and later ignore --load-extension, so an unpacked extension can only be
 * tested in Chrome for Testing, unless a path to another build is given.
 */
export async function findBrowser() {
  const override = process.env.PAGEHARVEST_CHROME_PATH;
  if (override) {
    return existsSync(override) ? { name: 'Chrome (PAGEHARVEST_CHROME_PATH)', path: override } : null;
  }
  const { chromium } = await import('@playwright/test');
  const path = chromium.executablePath();
  return existsSync(path) ? { name: 'Chrome for Testing', path } : null;
}

function automationBlockedReason() {
  if (process.platform !== 'win32') {
    return `The toolbar can only be driven on Windows; current platform is ${process.platform}.`;
  }
  const probe = spawnSync('python', ['-c', 'import pywinauto'], { encoding: 'utf8', windowsHide: true });
  return probe.status === 0 ? null : 'Python with pywinauto is not installed, so the toolbar cannot be clicked.';
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

async function waitFor(description, check, timeoutMs = STEP_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ''}`);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

function devtoolsCommand(target, method, params = {}) {
  return new Promise((resolvePromise, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`DevTools ${method} timed out`));
    }, STEP_TIMEOUT_MS);
    socket.onopen = () => socket.send(JSON.stringify({ id: 1, method, params }));
    socket.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`DevTools ${method} could not connect`));
    };
    socket.onmessage = (event) => {
      const reply = JSON.parse(event.data);
      if (reply.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      if (reply.error) reject(new Error(reply.error.message));
      else resolvePromise(reply.result);
    };
  });
}

async function evaluate(target, expression) {
  const result = await devtoolsCommand(target, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

function runToolbarAdapter(pid, args) {
  const run = spawnSync('python', [toolbarAdapter, '--pid', String(pid), ...args], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120000,
  });
  let output;
  try {
    output = JSON.parse((run.stdout ?? '').trim().split(/\r?\n/).pop() ?? '');
  } catch {
    output = { ok: false, error: (run.stderr ?? '').trim() || 'The toolbar adapter returned no result.' };
  }
  return { status: run.status, ...output };
}

/** Starts the fixture server unless one is already running. Returns how to stop it. */
async function ensureFixtureServer() {
  const isUp = () => fetch(FIXTURE_URL).then((response) => response.ok).catch(() => false);
  if (await isUp()) return () => undefined;
  const server = spawn(process.execPath, [join(repositoryRoot, 'tests/fixtures/serve.cjs')], { stdio: 'ignore' });
  await waitFor('the fixture server', isUp);
  return () => server.kill();
}

const clickPanelButton = (panel, label) =>
  waitFor(`the "${label}" button`, () =>
    evaluate(
      panel,
      `(() => {
        const button = [...document.querySelectorAll('button')]
          .find((item) => item.textContent.includes(${JSON.stringify(label)}) && !item.disabled);
        if (!button) return false;
        button.click();
        return true;
      })()`
    )
  );

const readFromDatabase = (panel, table) =>
  evaluate(
    panel,
    `new Promise((done, fail) => {
      const open = indexedDB.open('PageHarvestDB');
      open.onerror = () => fail(new Error(String(open.error)));
      open.onsuccess = () => {
        const db = open.result;
        const request = db.transaction(${JSON.stringify(table)}).objectStore(${JSON.stringify(table)}).getAll();
        request.onerror = () => fail(new Error(String(request.error)));
        request.onsuccess = () => {
          db.close();
          done(request.result);
        };
      };
    })`
  );

const SIDE_PANEL_CONTEXTS = `chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })
  .then((contexts) => contexts.map((context) => context.documentUrl))`;

async function collectEvidence({ browser, port, evidence, artifactDirectory, notes }) {
  const devtools = `http://127.0.0.1:${port}`;
  const listTargets = () => fetchJson(`${devtools}/json/list`);

  notes.version = (await waitFor('the browser', () => fetchJson(`${devtools}/json/version`))).Browser;

  // A fresh profile can leave a page from the command line blank, so it loads after startup.
  const page = await waitFor('the first tab', async () => (await listTargets()).find((target) => target.type === 'page'));
  await devtoolsCommand(page, 'Page.navigate', { url: FIXTURE_URL });
  await waitFor('the fixture page', async () => (await evaluate(page, 'document.readyState')) === 'complete');

  // The browser has built-in extensions of its own, so a worker alone proves nothing.
  const worker = await waitFor(`the ${EXTENSION_NAME} service worker`, async () => {
    const workers = (await listTargets()).filter(
      (target) => target.type === 'service_worker' && target.url.startsWith('chrome-extension://')
    );
    for (const candidate of workers) {
      if ((await evaluate(candidate, 'chrome.runtime.getManifest().name')) === EXTENSION_NAME) return candidate;
    }
    return null;
  }, 15000).catch(() => null);
  evidence.extensionLoaded = worker !== null;
  if (!worker) return;

  notes.extensionId = worker.url.match(/^chrome-extension:\/\/([^/]+)/)?.[1] ?? null;
  const panelUrl = `chrome-extension://${notes.extensionId}/sidepanel.html`;
  notes.panelsBeforeClick = await evaluate(worker, SIDE_PANEL_CONTEXTS);
  const findPanel = async () => (await listTargets()).find((target) => target.url === panelUrl);

  const openFromToolbar = (treeName) => {
    const result = runToolbarAdapter(browser.pid, ['--open', '--tree', join(artifactDirectory, treeName)]);
    if (result.status === 3) {
      evidence.automationAvailable = false;
      evidence.blockedReason = result.error;
    }
    notes[treeName] = result;
    return result.ok === true;
  };

  /** Only a context the browser itself reports as a side panel counts, not a tab. */
  const waitForSidePanel = () =>
    waitFor('the side panel', async () => {
      const panel = await findPanel();
      if (!panel) return null;
      return (await evaluate(panel, SIDE_PANEL_CONTEXTS)).includes(panelUrl) ? panel : null;
    }, 15000).catch(() => null);

  evidence.toolbarClicked = openFromToolbar('native-toolbar-first-open.txt');
  if (!evidence.toolbarClicked) return;

  const panel = await waitForSidePanel();
  evidence.panelOpened = panel !== null && notes.panelsBeforeClick.length === 0;
  if (!evidence.panelOpened) return;

  // A fresh profile opens the first-run tour over the panel, as it would for a new user.
  notes.tourShown = await clickPanelButton(panel, 'Skip tour').then(
    () => true,
    () => false
  );
  await clickPanelButton(panel, 'Find data automatically');
  await clickPanelButton(panel, 'Use this list');
  await clickPanelButton(panel, 'Next: Pagination');
  await clickPanelButton(panel, 'Start extraction');
  try {
    await waitFor('the job to complete', async () =>
      (await readFromDatabase(panel, 'jobs')).some((job) => job.status === 'COMPLETED')
    );
  } catch (error) {
    // Record what the job and the panel were doing, so a timeout can be told from a stall or a failure.
    const attempt = async (read) => read().catch((reason) => `unavailable: ${reason?.message ?? reason}`);
    notes.atJobTimeout = {
      jobs: await attempt(async () =>
        (await readFromDatabase(panel, 'jobs')).map((job) => ({
          status: job.status,
          pagination: job.schema?.pagination?.type,
          error: job.error ?? job.lastError ?? null,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        }))
      ),
      records: await attempt(async () => (await readFromDatabase(panel, 'records')).length),
      panelText: await attempt(() => evaluate(panel, 'document.body.innerText.slice(0, 2000)')),
      screenshot: runToolbarAdapter(browser.pid, [
        '--screenshot',
        join(artifactDirectory, 'native-job-timeout.png'),
      ]),
    };
    throw error;
  }
  evidence.rowsSaved = (await readFromDatabase(panel, 'records')).length;
  notes.screenshot = runToolbarAdapter(browser.pid, [
    '--screenshot',
    join(artifactDirectory, 'native-side-panel.png'),
  ]);

  // Closing the panel must lose nothing, and the toolbar must open it again.
  const closed = runToolbarAdapter(browser.pid, ['--close-panel']);
  notes.closePanel = closed;
  if (closed.ok !== true) {
    evidence.panelReopened = false;
    return;
  }
  await waitFor('the side panel to close', async () => !(await findPanel()));

  const reopenedClick = openFromToolbar('native-toolbar-reopen.txt');
  const reopened = reopenedClick ? await waitForSidePanel() : null;
  evidence.panelReopened = reopened !== null;
  if (reopened) {
    evidence.rowsAfterReopen = (await readFromDatabase(reopened, 'records')).length;
  }
}

export async function runNativeChromeCheck({
  buildLocation = resolve(repositoryRoot, '.output/chrome-mv3'),
  artifactDirectory = resolve(repositoryRoot, 'artifacts/release-testing/native-chrome'),
} = {}) {
  const startedAt = Date.now();
  await mkdir(artifactDirectory, { recursive: true });
  const profileDirectory = join(artifactDirectory, `profile-${Date.now()}`);
  const diagnosticsPath = join(artifactDirectory, 'native-chrome-diagnostics.json');
  const evidence = { automationAvailable: true, expectedRows: EXPECTED_ROWS };
  const notes = {};
  let browserInfo = null;
  let browser = null;
  let stopServer = () => undefined;

  try {
    const blockedReason = automationBlockedReason();
    browserInfo = await findBrowser();
    if (blockedReason) {
      evidence.automationAvailable = false;
      evidence.blockedReason = blockedReason;
    } else if (!browserInfo) {
      evidence.automationAvailable = false;
      evidence.blockedReason = 'No browser that can load an unpacked extension was found. Run: pnpm exec playwright install chromium';
    } else if (!existsSync(join(buildLocation, 'manifest.json'))) {
      evidence.error = `The production build is missing: ${buildLocation}`;
    } else {
      stopServer = await ensureFixtureServer();
      const port = await getFreePort();
      await mkdir(profileDirectory, { recursive: true });
      browser = spawn(browserInfo.path, [
        `--user-data-dir=${profileDirectory}`,
        `--disable-extensions-except=${buildLocation}`,
        `--load-extension=${buildLocation}`,
        `--remote-debugging-port=${port}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-sync',
        '--window-size=1000,680',
        'about:blank',
      ], { stdio: 'ignore', windowsHide: false });
      await collectEvidence({ browser, port, evidence, artifactDirectory, notes });
    }
  } catch (error) {
    evidence.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (browser) {
      browser.kill();
      await Promise.race([new Promise((done) => browser.once('exit', done)), sleep(3000)]);
    }
    stopServer();
    await rm(profileDirectory, { recursive: true, force: true }).catch(() => undefined);
  }

  const { status, details } = decideNativeStatus(evidence);
  await writeFile(
    diagnosticsPath,
    JSON.stringify({ status, details, evidence, notes, browser: browserInfo, capturedAt: new Date().toISOString() }, null, 2),
    'utf8'
  );

  const result = {
    name: 'native-chrome',
    status,
    exitCode: status === 'PASS' ? 0 : status === 'BLOCKED' ? 3 : 1,
    durationMs: Date.now() - startedAt,
    details,
    browser: {
      name: browserInfo?.name ?? 'Not found',
      version: notes.version?.replace(/^Chrome\//, '') ?? 'unknown',
    },
    extensionId: notes.extensionId ?? null,
    diagnosticsPath,
  };
  await writeFile(join(artifactDirectory, 'native-chrome-result.json'), JSON.stringify(result, null, 2), 'utf8');
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const result = await runNativeChromeCheck({
    artifactDirectory: resolve(
      repositoryRoot,
      process.env.PAGEHARVEST_RELEASE_ARTIFACT_DIR ?? 'artifacts/release-testing/native-chrome'
    ),
  });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.exitCode;
}

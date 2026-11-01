// Temporary: answers whether a Windows runner can click the real toolbar. Removed after the spike.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '../..');
const out = join(root, 'artifacts/spike');
mkdirSync(out, { recursive: true });
const build = join(root, '.output/chrome-mv3');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function json(url, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  throw new Error(`timeout ${url}`);
}

function evaluate(wsUrl, expression) {
  return new Promise((done, fail) => {
    const socket = new WebSocket(wsUrl);
    socket.onopen = () =>
      socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    socket.onmessage = (event) => {
      socket.close();
      done(JSON.parse(event.data));
    };
    socket.onerror = () => fail(new Error('socket error'));
  });
}

function python(pid, args) {
  const run = spawnSync('python', [join(root, 'scripts/release-testing/click-toolbar.py'), '--pid', String(pid), ...args], { encoding: 'utf8' });
  console.log(`python ${args.join(' ')} -> exit ${run.status}\n${run.stdout}${run.stderr}`);
  return run;
}

async function probe(label, executable, port, drive) {
  console.log(`\n===== ${label}: ${executable} exists=${existsSync(executable)}`);
  if (!existsSync(executable)) return;
  const profile = join(out, `profile-${label}`);
  const browser = spawn(executable, [
    `--user-data-dir=${profile}`,
    `--disable-extensions-except=${build}`,
    `--load-extension=${build}`,
    `--remote-debugging-port=${port}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,800',
    'http://127.0.0.1:3456/twenty-cards.html',
  ], { stdio: 'ignore' });
  try {
    console.log('version', (await json(`http://127.0.0.1:${port}/json/version`)).Browser);
    await sleep(4000);
    const targets = await json(`http://127.0.0.1:${port}/json/list`);
    console.log('targets', targets.map((t) => `${t.type} ${t.url}`));
    const worker = targets.find((t) => t.url.startsWith('chrome-extension://') && t.type === 'service_worker');
    console.log('extension loaded', Boolean(worker));
    python(browser.pid, ['--tree', join(out, `${label}-tree-before.txt`), '--screenshot', join(out, `${label}-before.png`)]);
    if (!drive || !worker) return;

    const contexts = "chrome.runtime.getContexts({contextTypes:['SIDE_PANEL']}).then(c=>c.map(x=>x.documentUrl))";
    console.log('panel before', JSON.stringify(await evaluate(worker.webSocketDebuggerUrl, contexts)));
    python(browser.pid, ['--open', '--tree', join(out, `${label}-tree-after.txt`)]);
    await sleep(4000);
    python(browser.pid, ['--screenshot', join(out, `${label}-after.png`)]);
    console.log('panel after', JSON.stringify(await evaluate(worker.webSocketDebuggerUrl, contexts)));
    const after = await json(`http://127.0.0.1:${port}/json/list`);
    console.log('targets after', after.map((t) => `${t.type} ${t.url}`));
  } catch (error) {
    console.log('probe error', error);
  } finally {
    browser.kill();
    await sleep(1500);
    rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  }
}

const server = spawn(process.execPath, [join(root, 'tests/fixtures/serve.cjs')], { stdio: 'ignore' });
await json('http://127.0.0.1:3456/simple-grid.html').catch(() => undefined);
await probe('chromium', chromium.executablePath(), 9301, true);
await probe('chrome', join(process.env.PROGRAMFILES ?? '', 'Google/Chrome/Application/chrome.exe'), 9302, false);
server.kill();
process.exit(0);

import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReleaseReport, formatReleaseReportMarkdown, scopeLayers } from './release-report.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const reportJsonPath = join(repositoryRoot, 'artifacts/release-test-report.json');
const reportMarkdownPath = join(repositoryRoot, 'artifacts/release-test-report.md');

function packageManagerCommand() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

function windowsCommandLine(command, args) {
  return [command, ...args].join(' ');
}

function getCommit() {
  const result = spawnSync('git', ['-c', 'safe.directory=C:/myProject/extension', 'rev-parse', '--short', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  return result.status === 0 ? result.stdout.trim() : 'unknown';
}

async function runCommand(name, args, artifactDirectory) {
  const startedAt = Date.now();
  const logPath = join(artifactDirectory, 'logs', `${name}.log`);
  await mkdir(dirname(logPath), { recursive: true });

  return await new Promise((resolvePromise) => {
    const child = process.platform === 'win32'
      ? spawn('cmd.exe', ['/d', '/s', '/c', windowsCommandLine(packageManagerCommand(), args)], {
        cwd: repositoryRoot,
        env: { ...process.env, FORCE_COLOR: '0' },
        windowsHide: true,
      })
      : spawn(packageManagerCommand(), args, {
      cwd: repositoryRoot,
      env: { ...process.env, FORCE_COLOR: '0' },
      windowsHide: true,
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      const text = String(chunk);
      output += text;
      process.stdout.write(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      output += text;
      process.stderr.write(text);
    });
    child.on('close', async (exitCode) => {
      await writeFile(logPath, output, 'utf8');
      resolvePromise({
        name,
        status: exitCode === 0 ? 'PASS' : 'FAIL',
        exitCode: exitCode ?? 1,
        durationMs: Date.now() - startedAt,
        details: output.trim().split(/\r?\n/).slice(-4).join(' '),
        logPath,
      });
    });
  });
}

async function loadPackage() {
  return JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'));
}

async function writeReport(checks, nativeResult = null) {
  const packageJson = await loadPackage();
  const report = buildReleaseReport({
    timestamp: new Date().toISOString(),
    commit: getCommit(),
    applicationVersion: packageJson.version,
    browser: nativeResult?.browser ?? { name: 'Not probed', version: 'unknown' },
    extension: {
      buildLocation: '.output/chrome-mv3',
      id: nativeResult?.extensionId ?? null,
    },
    environment: { platform: process.platform, arch: process.arch },
    checks,
  });
  await mkdir(dirname(reportJsonPath), { recursive: true });
  await writeFile(reportJsonPath, JSON.stringify(report, null, 2), 'utf8');
  await writeFile(reportMarkdownPath, formatReleaseReportMarkdown(report), 'utf8');
  console.log(`Release report: ${reportMarkdownPath}`);
  return report;
}

async function runScope(scope) {
  const runDirectory = join(repositoryRoot, 'artifacts/release-testing', new Date().toISOString().replace(/[:.]/g, '-'));
  await mkdir(runDirectory, { recursive: true });
  const checks = [];
  let nativeResult = null;

  if (scope === 'report') {
    try {
      const report = JSON.parse(await readFile(reportJsonPath, 'utf8'));
      console.log(formatReleaseReportMarkdown(report));
      return report.status === 'PASS' ? 0 : report.status === 'BLOCKED' ? 3 : 1;
    } catch {
      console.error(`No release report exists at ${reportJsonPath}.`);
      return 1;
    }
  }

  const layers = scopeLayers(scope);

  if (layers.unit) {
    checks.push(await runCommand('typecheck', ['typecheck'], runDirectory));
    checks.push(await runCommand('lint', ['lint'], runDirectory));
    checks.push(await runCommand('unit-integration', ['test', '--', '--reporter=dot'], runDirectory));
  }

  if (layers.e2e) {
    checks.push(await runCommand('build', ['build'], runDirectory));
    checks.push(await runCommand('chromium-e2e', ['test:e2e'], runDirectory));
  }

  if (layers.native) {
    const nativeCommand = process.platform === 'win32' ? process.execPath : process.execPath;
    const nativeProcess = spawnSync(nativeCommand, ['scripts/release-testing/native-chrome.mjs'], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        PAGEHARVEST_RELEASE_ARTIFACT_DIR: runDirectory,
      },
      encoding: 'utf8',
      windowsHide: false,
    });
    if (nativeProcess.stdout) process.stdout.write(nativeProcess.stdout);
    if (nativeProcess.stderr) process.stderr.write(nativeProcess.stderr);
    try {
      nativeResult = JSON.parse(await readFile(join(runDirectory, 'native-chrome-result.json'), 'utf8'));
      checks.push(nativeResult);
    } catch {
      checks.push({
        name: 'native-chrome',
        status: nativeProcess.status === 3 ? 'BLOCKED' : 'FAIL',
        exitCode: nativeProcess.status ?? 1,
        durationMs: 0,
        details: 'Native Chrome runner did not produce a result file.',
      });
    }
  }

  const report = await writeReport(checks, nativeResult);
  if (report.summary.failed > 0) return 1;
  if (report.summary.blocked > 0) return 3;
  return 0;
}

const requestedScope = process.argv.find((argument) => argument.startsWith('--scope='))?.split('=')[1] ?? 'all';
if (requestedScope !== 'report' && !scopeLayers(requestedScope)) {
  console.error(`Unknown release-test scope: ${requestedScope}`);
  process.exitCode = 1;
} else {
  process.exitCode = await runScope(requestedScope);
}

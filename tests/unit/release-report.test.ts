import { describe, expect, it } from 'vitest';
import {
  buildReleaseReport,
  decideNativeStatus,
  formatReleaseReportMarkdown,
  scopeLayers,
  type NativeEvidence,
  type ReleaseCheck,
} from '@/../scripts/release-testing/release-report.mjs';

describe('release testing report model', () => {
  it('marks the release blocked when a required native check is blocked', () => {
    const checks: ReleaseCheck[] = [
      { name: 'unit', status: 'PASS', exitCode: 0, durationMs: 12 },
      { name: 'native-chrome', status: 'BLOCKED', exitCode: 3, durationMs: 8 },
    ];

    const report = buildReleaseReport({
      timestamp: '2026-11-01T00:00:00.000Z',
      commit: 'abc1234',
      applicationVersion: '1.0.0',
      browser: { name: 'Google Chrome', version: '156.0.8078.75' },
      extension: { buildLocation: '.output/chrome-mv3', id: 'extension-id' },
      environment: { platform: 'win32', arch: 'x64' },
      checks,
    });

    expect(report.status).toBe('BLOCKED');
    expect(report.summary.blocked).toBe(1);
    expect(report.checks).toEqual(checks);
  });

  it('renders a human-readable report with explicit pass, fail, and blocked states', () => {
    const markdown = formatReleaseReportMarkdown({
      status: 'FAIL',
      timestamp: '2026-11-01T00:00:00.000Z',
      commit: 'abc1234',
      applicationVersion: '1.0.0',
      browser: { name: 'Chromium', version: '1' },
      extension: { buildLocation: '.output/chrome-mv3', id: null },
      environment: { platform: 'win32', arch: 'x64' },
      checks: [
        { name: 'unit', status: 'PASS', exitCode: 0, durationMs: 10 },
        { name: 'e2e', status: 'FAIL', exitCode: 1, durationMs: 20, details: '2 failed' },
        { name: 'native-chrome', status: 'BLOCKED', exitCode: 3, durationMs: 5 },
      ],
      summary: { passed: 1, failed: 1, skipped: 0, blocked: 1 },
    });

    expect(markdown).toContain('# PageHarvest Release Test Report');
    expect(markdown).toContain('| e2e | FAIL | 1 | 2 failed |');
    expect(markdown).toContain('| native-chrome | BLOCKED | 3 |');
  });
});

describe('native side panel evidence', () => {
  const complete: NativeEvidence = {
    automationAvailable: true,
    extensionLoaded: true,
    toolbarClicked: true,
    panelOpened: true,
    rowsSaved: 20,
    panelReopened: true,
    rowsAfterReopen: 20,
    expectedRows: 20,
  };

  it('passes only when the toolbar opened a working panel and the rows lasted', () => {
    expect(decideNativeStatus(complete).status).toBe('PASS');
  });

  it('is blocked, not failed or passed, when the automation cannot run', () => {
    const { status, details } = decideNativeStatus({
      automationAvailable: false,
      blockedReason: 'pywinauto is not installed.',
      expectedRows: 20,
    });

    expect(status).toBe('BLOCKED');
    expect(details).toContain('pywinauto');
  });

  it.each<[string, Partial<NativeEvidence>, RegExp]>([
    ['the extension did not load', { extensionLoaded: false }, /did not load/],
    ['the toolbar could not be clicked', { toolbarClicked: false }, /toolbar/],
    ['the click opened no panel', { panelOpened: false }, /side panel/],
    ['the panel saved no rows', { rowsSaved: 0 }, /0 of 20/],
    ['the panel saved too few rows', { rowsSaved: 19 }, /19 of 20/],
    ['the panel did not reopen', { panelReopened: false }, /reopen/],
    ['rows were lost by closing the panel', { rowsAfterReopen: 3 }, /3 of 20/],
  ])('fails when %s', (_name, change, message) => {
    const { status, details } = decideNativeStatus({ ...complete, ...change });

    expect(status).toBe('FAIL');
    expect(details).toMatch(message);
  });

  it('never passes when a step has no evidence at all', () => {
    for (const step of ['extensionLoaded', 'toolbarClicked', 'panelOpened', 'rowsSaved', 'panelReopened', 'rowsAfterReopen']) {
      const partial: NativeEvidence = { ...complete };
      delete partial[step as keyof NativeEvidence];

      expect(decideNativeStatus(partial).status).toBe('FAIL');
    }
  });

  it('reports an unexpected error as a failure, whatever came before it', () => {
    const { status, details } = decideNativeStatus({ ...complete, error: 'The browser crashed.' });

    expect(status).toBe('FAIL');
    expect(details).toContain('The browser crashed.');
  });
});

describe('release scopes', () => {
  it('keeps the native check out of the automated scope', () => {
    expect(scopeLayers('automated')).toEqual({ unit: true, e2e: true, native: false });
  });

  it('runs every layer in the complete scope', () => {
    expect(scopeLayers('all')).toEqual({ unit: true, e2e: true, native: true });
  });

  it('runs only the native check in the chrome scope', () => {
    expect(scopeLayers('chrome')).toEqual({ unit: false, e2e: false, native: true });
  });

  it('does not recognize an unknown scope', () => {
    expect(scopeLayers('everything')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildReleaseReport,
  formatReleaseReportMarkdown,
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

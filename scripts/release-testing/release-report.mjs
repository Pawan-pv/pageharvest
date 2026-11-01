/**
 * Pure release-report construction and Markdown rendering.
 * Filesystem and command execution are intentionally kept out of this module
 * so the report contract can be covered by Vitest without browser side effects.
 */

export function buildReleaseReport(input) {
  const summary = input.summary ?? summarizeChecks(input.checks);
  const status = input.status ?? (
    summary.failed > 0
      ? 'FAIL'
      : summary.blocked > 0
        ? 'BLOCKED'
        : 'PASS'
  );

  return {
    ...input,
    status,
    summary,
    checks: input.checks,
  };
}

export function summarizeChecks(checks) {
  return checks.reduce(
    (summary, check) => {
      if (check.status === 'PASS') summary.passed += 1;
      if (check.status === 'FAIL') summary.failed += 1;
      if (check.status === 'SKIPPED') summary.skipped += 1;
      if (check.status === 'BLOCKED') summary.blocked += 1;
      return summary;
    },
    { passed: 0, failed: 0, skipped: 0, blocked: 0 }
  );
}

export function formatReleaseReportMarkdown(report) {
  const lines = [
    '# PageHarvest Release Test Report',
    '',
    `- Status: **${report.status}**`,
    `- Timestamp: ${report.timestamp}`,
    `- Commit: ${report.commit}`,
    `- Application version: ${report.applicationVersion}`,
    `- Browser: ${report.browser.name} ${report.browser.version}`,
    `- Extension ID: ${report.extension.id ?? 'unknown'}`,
    `- Build location: \`${report.extension.buildLocation}\``,
    `- Environment: ${report.environment.platform}/${report.environment.arch}`,
    '',
    '## Summary',
    '',
    '| Result | Count |',
    '| --- | ---: |',
    `| PASS | ${report.summary.passed} |`,
    `| FAIL | ${report.summary.failed} |`,
    `| SKIPPED | ${report.summary.skipped} |`,
    `| BLOCKED | ${report.summary.blocked} |`,
    '',
    '## Checks',
    '',
    '| Check | Status | Exit code | Details |',
    '| --- | --- | ---: | --- |',
    ...report.checks.map((check) =>
      `| ${check.name} | ${check.status} | ${check.exitCode ?? ''} | ${check.details ?? ''} |`
    ),
    '',
  ];

  return lines.join('\n');
}

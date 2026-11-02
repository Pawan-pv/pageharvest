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

const SCOPE_LAYERS = {
  unit: { unit: true, e2e: false, native: false },
  e2e: { unit: false, e2e: true, native: false },
  chrome: { unit: false, e2e: false, native: true },
  // For machines that cannot click a browser toolbar. The native check runs elsewhere.
  automated: { unit: true, e2e: true, native: false },
  all: { unit: true, e2e: true, native: true },
};

/** Which layers a scope runs, or null for a scope that does not exist. */
export function scopeLayers(scope) {
  return Object.hasOwn(SCOPE_LAYERS, scope) ? SCOPE_LAYERS[scope] : null;
}

/**
 * Turns what the native check observed into its result. A step with no evidence is a
 * failure, so PASS can only come from a complete run.
 */
export function decideNativeStatus(evidence) {
  if (evidence.error) return { status: 'FAIL', details: evidence.error };
  if (!evidence.automationAvailable) {
    return { status: 'BLOCKED', details: evidence.blockedReason ?? 'The toolbar automation cannot run here.' };
  }

  const { expectedRows } = evidence;
  const fail = (details) => ({ status: 'FAIL', details });
  if (evidence.extensionLoaded !== true) return fail('The unpacked extension did not load in the browser.');
  if (evidence.toolbarClicked !== true) return fail('The extension could not be clicked in the toolbar.');
  if (evidence.panelOpened !== true) return fail('Clicking the toolbar did not open the side panel.');
  if (evidence.rowsSaved !== expectedRows) {
    return fail(`The side panel saved ${evidence.rowsSaved ?? 'no'} of ${expectedRows} rows.`);
  }
  if (evidence.panelReopened !== true) return fail('The side panel did not close and reopen from the toolbar.');
  if (evidence.rowsAfterReopen !== expectedRows) {
    return fail(`After reopening the side panel, ${evidence.rowsAfterReopen ?? 'no'} of ${expectedRows} rows remained.`);
  }

  return {
    status: 'PASS',
    details: `A toolbar click opened the side panel, ${expectedRows} rows were saved, and they were still there after closing and reopening it.`,
  };
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

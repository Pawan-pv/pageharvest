export type ReleaseStatus = 'PASS' | 'FAIL' | 'SKIPPED' | 'BLOCKED';

export interface ReleaseCheck {
  name: string;
  status: ReleaseStatus;
  exitCode?: number;
  durationMs: number;
  details?: string;
  logPath?: string;
}

export interface ReleaseSummary {
  passed: number;
  failed: number;
  skipped: number;
  blocked: number;
}

export interface ReleaseReport {
  status: Exclude<ReleaseStatus, 'SKIPPED'>;
  timestamp: string;
  commit: string;
  applicationVersion: string;
  browser: { name: string; version: string };
  extension: { buildLocation: string; id: string | null };
  environment: { platform: string; arch: string };
  checks: ReleaseCheck[];
  summary: ReleaseSummary;
}

export interface ReleaseReportInput extends Omit<ReleaseReport, 'status' | 'summary'> {
  status?: ReleaseReport['status'];
  summary?: ReleaseSummary;
}

export function summarizeChecks(checks: ReleaseCheck[]): ReleaseSummary;
export function buildReleaseReport(input: ReleaseReportInput): ReleaseReport;
export function formatReleaseReportMarkdown(report: ReleaseReport): string;

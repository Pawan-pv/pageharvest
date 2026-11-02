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

export interface NativeEvidence {
  automationAvailable: boolean;
  blockedReason?: string;
  error?: string;
  expectedRows: number;
  extensionLoaded?: boolean;
  toolbarClicked?: boolean;
  panelOpened?: boolean;
  rowsSaved?: number;
  panelReopened?: boolean;
  rowsAfterReopen?: number;
}

export interface ScopeLayers {
  unit: boolean;
  e2e: boolean;
  native: boolean;
}

export function scopeLayers(scope: string): ScopeLayers | null;
export function decideNativeStatus(evidence: NativeEvidence): { status: ReleaseStatus; details: string };
export function summarizeChecks(checks: ReleaseCheck[]): ReleaseSummary;
export function buildReleaseReport(input: ReleaseReportInput): ReleaseReport;
export function formatReleaseReportMarkdown(report: ReleaseReport): string;

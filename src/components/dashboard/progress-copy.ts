import type { JobProgressKind } from '@/shared/contracts/job';

export interface ProgressInput {
  kind: JobProgressKind;
  /** Pages visited or scrolls completed. */
  step: number;
  /** The limit the job runs to, when one is known. */
  total?: number;
  rows: number;
}

export interface ProgressCopy {
  /** "Page 3 of 20", "Page 3", "Scroll 6 of 30" or "This page". */
  stepLabel: string;
  /** The step label with the rows collected so far. */
  summary: string;
  /** Only when the total is known. */
  percent: number | null;
}

export function formatRows(count: number): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? 'row' : 'rows'}`;
}

/**
 * Progress in the unit the job advances by. A total is shown only when it is known: a job
 * stored without one is read by the panel as 1, so a total below the current step is unknown.
 */
export function describeProgress({ kind, step, total, rows }: ProgressInput): ProgressCopy {
  const rowsText = `${formatRows(rows)} so far`;
  if (kind === 'single') {
    return { stepLabel: 'This page', summary: `This page, ${rowsText}`, percent: null };
  }
  const unit = kind === 'scrolls' ? 'Scroll' : 'Page';
  const known = total !== undefined && total >= step && total > 0;
  const stepLabel = known ? `${unit} ${step} of ${total}` : `${unit} ${step}`;
  return {
    stepLabel,
    summary: `${stepLabel}, ${rowsText}`,
    percent: known ? Math.min(100, Math.round((step / total) * 100)) : null,
  };
}

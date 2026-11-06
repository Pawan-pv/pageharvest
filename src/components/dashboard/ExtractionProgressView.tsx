import React, { useId } from 'react';
import { Loader2, Pause, Play, Square, AlertCircle } from 'lucide-react';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { HelpTip } from '@/components/common/Tooltip';
import { Banner } from '@/components/common/Banner';
import { ErrorBanner } from '@/components/common/ErrorBanner';
import { ExtractionStats } from '@/hooks/useExtractionWorkflow';
import { describeProgress } from './progress-copy';

export interface ExtractionProgressViewProps {
  stats: ExtractionStats;
  /** Rows above this count show a size warning. */
  recordWarningThreshold?: number;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onCancel: () => void;
}

const STEP_LABEL = { single: 'Scope', pages: 'Pages', scrolls: 'Scrolls' } as const;

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/** A counter: the label is a <dt> and the value its <dd>, so they are read together. */
const Metric: React.FC<{ label: string; value: React.ReactNode; help?: React.ReactNode; large?: boolean }> = ({
  label,
  value,
  help,
  large = false,
}) => (
  <div className="p-2.5 rounded-control bg-surface-sunken border border-line">
    <dt className="flex items-center gap-1 text-2xs text-fg-subtle">
      {label}
      {help}
    </dt>
    <dd className={`${large ? 'text-lg font-bold' : 'text-sm font-semibold'} text-fg tracking-tight`}>{value}</dd>
  </div>
);

/**
 * A running job, read from storage. The background owns the job: closing the panel does not
 * stop it, so the panel says so while the job is active.
 */
export const ExtractionProgressView: React.FC<ExtractionProgressViewProps> = ({
  stats,
  recordWarningThreshold,
  onPause,
  onResume,
  onStop,
  onCancel,
}) => {
  const finishHintId = useId();
  const cancelHintId = useId();
  const isPaused = stats.status === 'PAUSED';
  const isError = stats.status === 'FAILED';
  const isActive = !isError;
  const progress = describeProgress({
    kind: stats.progressKind,
    step: stats.currentStep,
    total: stats.targetSteps,
    rows: stats.totalExtracted,
  });
  const title = isError ? 'Extraction stopped by a problem' : isPaused ? 'Extraction paused' : 'Collecting rows…';

  return (
    <div className="flex flex-col gap-3 p-4 text-left">
      <Card className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          {isError ? (
            <AlertCircle aria-hidden="true" className="w-5 h-5 text-danger-fg" />
          ) : isPaused ? (
            <Pause aria-hidden="true" className="w-5 h-5 text-warning-fg" />
          ) : (
            <Loader2 aria-hidden="true" className="w-5 h-5 text-brand-fg motion-safe:animate-spin" />
          )}
          <h2 className="text-base font-semibold text-fg">{title}</h2>
        </div>

        <p className="text-xs text-fg-muted" aria-live="polite">
          {progress.summary}
        </p>

        <div
          role="progressbar"
          aria-label="Extraction progress"
          aria-valuemin={progress.percent === null ? undefined : 0}
          aria-valuemax={progress.percent === null ? undefined : 100}
          aria-valuenow={progress.percent ?? undefined}
          aria-valuetext={progress.summary}
          className="w-full bg-surface-muted rounded-pill h-2 overflow-hidden"
        >
          <div
            className={`h-2 rounded-pill transition-[width] duration-300 ${
              isPaused ? 'bg-warning' : isError ? 'bg-danger' : 'bg-brand'
            } ${progress.percent === null && !isPaused && !isError ? 'motion-safe:animate-pulse' : ''}`}
            style={{ width: `${progress.percent ?? 100}%` }}
          />
        </div>

        <dl className="grid grid-cols-2 gap-2">
          <Metric label="Rows saved" value={stats.totalExtracted} large />
          <Metric label="Time" value={formatTime(stats.elapsedSeconds)} large />
          <Metric label={STEP_LABEL[stats.progressKind]} value={progress.stepLabel} />
          <Metric label="Duplicates skipped" value={stats.duplicatesSkipped} help={<HelpTip tipId="dedup" />} />
        </dl>

        {/* What happened to each detected item, so nothing disappears silently */}
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-2xs text-fg-subtle">
          <div className="flex justify-between">
            <dt>Items detected</dt>
            <dd className="font-semibold text-fg-muted">{stats.recordsDetected}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Missing some fields</dt>
            <dd className="font-semibold text-fg-muted">{stats.recordsWithMissingFields}</dd>
          </div>
          <div className="flex justify-between items-center">
            <dt className="flex items-center gap-0.5">
              Rows excluded
              <HelpTip tipId="required-field" />
            </dt>
            <dd className="font-semibold text-fg-muted">{stats.recordsFiltered}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Failed</dt>
            <dd className="font-semibold text-fg-muted">{stats.recordsFailed}</dd>
          </div>
        </dl>

        {recordWarningThreshold !== undefined && stats.totalExtracted >= recordWarningThreshold && (
          <Banner tone="warning" title="Large dataset">
            This extraction has passed {recordWarningThreshold.toLocaleString()} rows. The table may be slow to scroll.
          </Banner>
        )}

        {isError && <ErrorBanner error={{ message: stats.errorMessage, code: stats.errorCode }} />}
      </Card>

      {isActive && (
        <Banner tone="info">
          You can close this panel. The job keeps running in the background, and rows are saved as they arrive.
        </Banner>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {isPaused ? (
            <Button
              variant="outline"
              size="sm"
              iconLeft={<Play aria-hidden="true" className="w-3.5 h-3.5 fill-current" />}
              onClick={onResume}
            >
              Resume
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              iconLeft={<Pause aria-hidden="true" className="w-3.5 h-3.5" />}
              onClick={onPause}
              disabled={isError}
            >
              Pause
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            iconLeft={<Square aria-hidden="true" className="w-3.5 h-3.5 fill-current" />}
            onClick={onStop}
            aria-describedby={finishHintId}
          >
            Finish and view rows
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel} aria-describedby={cancelHintId}>
            {isError ? 'Close' : 'Cancel job'}
          </Button>
          <HelpTip tipId="finish-vs-cancel" />
        </div>
        <p className="text-2xs text-fg-subtle">
          <span id={finishHintId}>Finish stops now and shows the rows collected so far.</span>{' '}
          <span id={cancelHintId}>Cancel stops the job; saved rows stay in Datasets.</span>
        </p>
      </div>
    </div>
  );
};

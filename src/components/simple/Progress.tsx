import React from 'react';
import { AlertCircle, Loader2, Pause, Play } from 'lucide-react';
import { Banner } from '@/components/common/Banner';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { ErrorBanner } from '@/components/common/ErrorBanner';
import { describeProgress } from '@/components/dashboard/progress-copy';
import type { ExtractionStats } from '@/hooks/useExtractionWorkflow';

export interface SimpleProgressProps {
  stats: ExtractionStats;
  onPause: () => void;
  onResume: () => void;
  /** Ends the job now and opens the rows collected so far. */
  onStop: () => void;
  /** Leaves a job that a problem has already stopped. Its saved rows stay in My data. */
  onClose: () => void;
}

/**
 * A running job in simple mode (ADR-039): how many rows are saved, how far along it is, and
 * one way to stop that keeps everything. The counts of duplicates, missing values and
 * excluded rows are under Advanced options.
 */
export const SimpleProgress: React.FC<SimpleProgressProps> = ({ stats, onPause, onResume, onStop, onClose }) => {
  const isPaused = stats.status === 'PAUSED';
  const isError = stats.status === 'FAILED';
  const progress = describeProgress({
    kind: stats.progressKind,
    step: stats.currentStep,
    total: stats.targetSteps,
    rows: stats.totalExtracted,
  });
  const rows = stats.totalExtracted;
  const title = isError ? 'A problem stopped the collecting' : isPaused ? 'Paused' : 'Collecting your rows…';

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

        <p aria-live="polite" className="flex items-baseline gap-2">
          <span className="text-3xl font-bold text-fg tracking-tight">{rows.toLocaleString('en-US')}</span>
          <span className="text-sm text-fg-muted">{rows === 1 ? 'row saved so far' : 'rows saved so far'}</span>
        </p>

        <div
          role="progressbar"
          aria-label="How far along"
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
        {stats.progressKind !== 'single' && <p className="text-body text-fg-muted">{progress.stepLabel}</p>}

        {isError && <ErrorBanner error={{ message: stats.errorMessage, code: stats.errorCode }} />}
      </Card>

      {!isError && (
        <Banner tone="info">
          You can close this panel. PageHarvest keeps working, and your rows are saved as they arrive.
        </Banner>
      )}

      <div className="flex flex-col gap-2">
        <Button size="lg" className="w-full justify-center font-semibold" onClick={onStop}>
          {isError ? 'See the rows I have' : 'Stop here and keep my rows'}
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          {isError ? (
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          ) : isPaused ? (
            <Button
              variant="outline"
              size="sm"
              iconLeft={<Play aria-hidden="true" className="w-3.5 h-3.5 fill-current" />}
              onClick={onResume}
            >
              Continue
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              iconLeft={<Pause aria-hidden="true" className="w-3.5 h-3.5" />}
              onClick={onPause}
            >
              Pause
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

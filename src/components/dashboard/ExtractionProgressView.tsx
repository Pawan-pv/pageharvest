import React from 'react';
import { Loader2, Pause, Play, Square, Clock, Layers, CopyX, AlertCircle } from 'lucide-react';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Badge } from '@/components/common/Badge';
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

const PROGRESS_LABEL = { single: 'Scope', pages: 'Pages', scrolls: 'Scrolling' } as const;

export const ExtractionProgressView: React.FC<ExtractionProgressViewProps> = ({
  stats,
  recordWarningThreshold,
  onPause,
  onResume,
  onStop,
  onCancel,
}) => {
  const isPaused = stats.status === 'PAUSED';
  const isError = stats.status === 'FAILED';
  const progress = describeProgress({
    kind: stats.progressKind,
    step: stats.currentStep,
    total: stats.targetSteps,
    rows: stats.totalExtracted,
  });

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col gap-4 p-4 text-left">
      <Card variant="default" className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {!isPaused && !isError ? (
              <Loader2 className="w-5 h-5 text-brand-fg animate-spin" />
            ) : isPaused ? (
              <Pause className="w-5 h-5 text-warning-fg" />
            ) : (
              <AlertCircle className="w-5 h-5 text-danger-fg" />
            )}
            <h3 className="text-base font-semibold text-fg">
              {isPaused ? 'Extraction Paused' : isError ? 'Extraction Interrupted' : 'Harvesting in Progress...'}
            </h3>
          </div>

          <Badge
            variant={isPaused ? 'warning' : isError ? 'danger' : 'brand'}
            size="md"
          >
            {stats.status}
          </Badge>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-surface-muted rounded-full h-2 mb-4 overflow-hidden">
          <div
            className={`h-2 transition-all duration-300 rounded-full ${
              isPaused ? 'bg-warning' : isError ? 'bg-danger' : 'bg-brand animate-pulse'
            }`}
            style={{ width: `${progress.percent ?? 100}%` }}
          />
        </div>

        {/* Real-time metrics grid */}
        <div className="grid grid-cols-2 gap-2.5 mb-2">
          <div className="p-3 rounded-lg bg-surface-sunken border border-line/70">
            <div className="flex items-center gap-1.5 text-fg-subtle text-2xs mb-1">
              <Layers className="w-3.5 h-3.5 text-brand-fg" />
              <span>Records Harvested</span>
            </div>
            <span className="text-lg font-bold text-fg tracking-tight">
              {stats.totalExtracted}
            </span>
          </div>

          <div className="p-3 rounded-lg bg-surface-sunken border border-line/70">
            <div className="flex items-center gap-1.5 text-fg-subtle text-2xs mb-1">
              <Clock className="w-3.5 h-3.5 text-info-fg" />
              <span>Elapsed Time</span>
            </div>
            <span className="text-lg font-bold text-fg tracking-tight font-mono">
              {formatTime(stats.elapsedSeconds)}
            </span>
          </div>

          <div className="p-3 rounded-lg bg-surface-sunken border border-line/70">
            <div className="flex items-center gap-1.5 text-fg-subtle text-2xs mb-1">
              <span>{PROGRESS_LABEL[stats.progressKind]}</span>
            </div>
            <span className="text-sm font-semibold text-fg">
              {progress.stepLabel}
            </span>
          </div>

          <div className="p-3 rounded-lg bg-surface-sunken border border-line/70">
            <div className="flex items-center gap-1.5 text-fg-subtle text-2xs mb-1">
              <CopyX className="w-3.5 h-3.5 text-fg-subtle" />
              <span>Duplicates Skipped</span>
              <HelpTip tipId="dedup" />
            </div>
            <span className="text-sm font-semibold text-fg">
              {stats.duplicatesSkipped}
            </span>
          </div>
        </div>

        {/* What happened to each detected item, so nothing disappears silently */}
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-2xs text-fg-subtle mt-3">
          <div className="flex justify-between">
            <dt>Items detected</dt>
            <dd className="font-semibold text-fg-muted">{stats.recordsDetected}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Missing some fields</dt>
            <dd className="font-semibold text-fg-muted">{stats.recordsWithMissingFields}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Filtered out</dt>
            <dd className="font-semibold text-fg-muted">{stats.recordsFiltered}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Failed</dt>
            <dd className="font-semibold text-fg-muted">{stats.recordsFailed}</dd>
          </div>
        </dl>

        {recordWarningThreshold !== undefined && stats.totalExtracted >= recordWarningThreshold && (
          <Banner tone="warning" title="Large dataset" className="mt-3">
            This extraction has passed {recordWarningThreshold.toLocaleString()} rows. The grid may slow down.
          </Banner>
        )}

        {/* Error notice if present */}
        {isError && <ErrorBanner error={{ message: stats.errorMessage }} className="mt-3" />}
      </Card>

      {/* Control Buttons */}
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onCancel}
          title="Stops the job. Rows already saved stay in Datasets."
        >
          {isError ? 'Close' : 'Cancel Job'}
        </Button>

        <div className="flex items-center gap-2">
          {isPaused ? (
            <Button
              variant="outline"
              size="sm"
              iconLeft={<Play className="w-3.5 h-3.5 fill-current" />}
              onClick={onResume}
            >
              Resume
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              iconLeft={<Pause className="w-3.5 h-3.5" />}
              onClick={onPause}
              disabled={isError}
            >
              Pause
            </Button>
          )}

          <Button
            variant="primary"
            size="sm"
            iconLeft={<Square className="w-3.5 h-3.5 fill-current" />}
            onClick={onStop}
          >
            Finish & View Results
          </Button>
        </div>
      </div>
    </div>
  );
};

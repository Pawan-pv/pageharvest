import React, { useMemo } from 'react';
import { Check, ExternalLink, Pause, Play, X } from 'lucide-react';
import { openWorkbench } from '@/platform/workbench';
import type { ExtractionStats } from '@/hooks/useExtractionWorkflow';
import type { Dataset, ExtractedRecord } from '@/types';

export interface ListRunningViewProps {
  stats: ExtractionStats;
  records?: ExtractedRecord[];
  dataset?: Dataset | null;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

function extractPrimaryText(record: ExtractedRecord): string {
  for (const [key, val] of Object.entries(record)) {
    if (key === 'id' || key === 'datasetId' || key.startsWith('_')) continue;
    if (typeof val === 'string' && val.trim().length > 0) {
      return val.trim();
    }
  }
  return 'Captured item';
}

export const ListRunningView: React.FC<ListRunningViewProps> = ({
  stats,
  records = [],
  dataset,
  onPause,
  onResume,
  onStop,
}) => {
  const isPaused = stats.status === 'PAUSED';
  const isFailed = stats.status === 'FAILED';
  const isStoppedMotion = isPaused || isFailed;
  const elapsed = stats.elapsedSeconds || 0;
  const count = stats.totalExtracted || records.length;
  const speed = elapsed > 0 ? (count / elapsed).toFixed(1) : '0.0';

  // Smart Live Visual Feed analysis
  const recentRecords = useMemo(() => records.slice(-5), [records]);

  const handleOpenLiveWorkbench = () => {
    if (dataset?.id) {
      void openWorkbench({ datasetId: dataset.id });
    } else {
      void openWorkbench();
    }
  };

  return (
    <div className="relative flex flex-col gap-5 p-4 text-left overflow-hidden min-h-[460px]">
      {/* Ambient radial emerald top glow */}
      <div
        className={`pointer-events-none absolute -top-16 left-1/2 -translate-x-1/2 h-56 w-56 rounded-full ${
          isFailed ? 'bg-danger/10' : 'bg-brand/15'
        } blur-3xl ${isStoppedMotion ? '' : 'ph-aura-breathe motion-reduce:animate-none'}`}
        aria-hidden="true"
      />

      {/* Header Info */}
      <div className="flex items-center justify-between text-2xs z-10">
        <span className="font-bold uppercase tracking-wider text-brand-fg">
          Live Extraction Stage
        </span>
        <span className="flex items-center gap-1.5 font-medium text-fg-subtle">
          <span
            className={`h-2 w-2 rounded-full ${
              isFailed
                ? 'bg-danger'
                : isPaused
                  ? 'bg-warning'
                  : 'bg-brand animate-pulse motion-reduce:animate-none'
            }`}
          />
          {isFailed ? 'Extraction Failed' : isPaused ? 'Extraction Paused' : 'Harvesting page…'}
        </span>
      </div>

      {/* SVG Dual-Arc Pulse Ring (140x140) */}
      <div className="relative flex flex-col items-center justify-center py-2 z-10">
        <div className="relative flex h-[140px] w-[140px] items-center justify-center">
          <svg className="h-[140px] w-[140px] -rotate-90 transform" viewBox="0 0 140 140">
            {/* Background track ring */}
            <circle
              cx="70"
              cy="70"
              r="58"
              stroke="rgb(var(--ph-line))"
              strokeWidth="6"
              fill="none"
            />
            {/* Animated rotating emerald arc */}
            <circle
              cx="70"
              cy="70"
              r="58"
              stroke={isFailed ? 'rgb(var(--ph-danger))' : 'rgb(var(--ph-brand))'}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray="110 254"
              fill="none"
              className={isStoppedMotion ? '' : 'ph-ring-spin motion-reduce:animate-none'}
              style={{
                filter: isFailed
                  ? 'drop-shadow(0 0 8px rgb(var(--ph-danger) / 0.35))'
                  : 'drop-shadow(0 0 8px rgb(var(--ph-brand) / 0.35))',
              }}
            />
          </svg>

          {/* Upright Center Counter */}
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-3xl font-extrabold tracking-tight text-fg tabular-nums">
              {count.toLocaleString('en-US')}
            </span>
            <span className="text-2xs font-bold tracking-widest text-brand-fg uppercase mt-0.5">
              ITEMS EXTRACTED
            </span>
          </div>
        </div>
      </div>

      {isFailed && stats.errorMessage && (
        <div
          role="alert"
          className="z-10 rounded-xl border border-danger-line bg-danger-soft px-3 py-2 text-2xs font-medium text-danger-fg"
        >
          {stats.errorMessage}
        </div>
      )}

      {/* Smart Live Visual Feed */}
      <div className="flex flex-col gap-1.5 z-10">
        <div className="flex items-center justify-between text-2xs font-semibold text-fg-subtle uppercase tracking-wider">
          <span>Live Preview Feed</span>
          <span>Text streaming</span>
        </div>

        {/* Latest 5 live rows sliding in as structured text previews */}
        <div className="flex flex-col gap-1.5">
          {recentRecords.length > 0 ? (
            recentRecords.map((rec, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 rounded-xl border border-line-subtle bg-surface px-3 py-1.5 text-xs text-fg-muted truncate ph-pop-in motion-reduce:animate-none"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                <span className="truncate">{extractPrimaryText(rec)}</span>
              </div>
            ))
          ) : (
            <div
              className={`flex items-center gap-2 rounded-xl border border-line-subtle bg-surface px-3 py-2 text-xs text-fg-subtle ${
                isFailed ? '' : 'ph-shimmer motion-reduce:animate-none'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  isFailed ? 'bg-danger/60' : 'bg-brand/40'
                }`}
              />
              <span>{isFailed ? 'No items captured.' : 'Waiting for page batches…'}</span>
            </div>
          )}
        </div>
      </div>

      {/* 3-Column Telemetry Card */}
      <div className="grid grid-cols-3 divide-x divide-line-subtle rounded-2xl border border-line bg-surface p-3 text-center z-10 shadow-sm">
        <div className="flex flex-col items-center">
          <span className="text-2xs font-semibold tracking-wider text-fg-subtle uppercase">
            ELAPSED
          </span>
          <span className="text-sm font-bold text-fg tabular-nums mt-0.5">
            {formatElapsed(elapsed)}
          </span>
        </div>

        <div className="flex flex-col items-center">
          <span className="text-2xs font-semibold tracking-wider text-fg-subtle uppercase">
            SPEED
          </span>
          <span className="text-sm font-bold text-fg tabular-nums mt-0.5">
            {speed}/s
          </span>
        </div>

        <div className="flex flex-col items-center">
          <span className="text-2xs font-semibold tracking-wider text-fg-subtle uppercase">
            STATUS
          </span>
          <span
            className={`text-sm font-bold mt-0.5 ${
              isFailed ? 'text-danger-fg' : isPaused ? 'text-warning-fg' : 'text-brand-fg'
            }`}
          >
            {isFailed ? (
              'Failed'
            ) : isPaused ? (
              'Paused'
            ) : (
              <span className="inline-flex items-center justify-center gap-1">
                <span>Local</span>
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            )}
          </span>
        </div>
      </div>

      {/* Bottom Action Stack */}
      <div className="mt-auto flex flex-col gap-2 pt-2 z-10">
        <button
          type="button"
          onClick={handleOpenLiveWorkbench}
          className="flex items-center justify-between rounded-xl border border-brand/40 bg-brand-soft py-2.5 px-3.5 text-xs font-semibold text-brand-fg shadow-glow-emerald transition-all hover:bg-brand/20 hover:text-brand-emphasis active:scale-[0.99] cursor-pointer"
        >
          <span className="flex items-center gap-1.5">
            <span>View results live</span>
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </span>
          <span className="rounded-full bg-brand/20 px-2 py-0.5 text-2xs font-bold text-brand-emphasis tabular-nums">
            {count}
          </span>
        </button>

        <div className="flex items-center gap-2">
          {!isFailed &&
            (isPaused ? (
              <button
                type="button"
                onClick={onResume}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-brand/40 bg-brand-soft py-2 px-3 text-xs font-bold text-brand-fg transition-colors hover:bg-brand/20 hover:text-brand-emphasis cursor-pointer"
              >
                <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                <span>Resume</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onPause}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-line bg-surface py-2 px-3 text-xs font-semibold text-fg transition-colors hover:border-line-strong cursor-pointer"
              >
                <Pause className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                <span>Pause</span>
              </button>
            ))}

          <button
            type="button"
            onClick={onStop}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-danger-line bg-danger-soft py-2 px-3 text-xs font-semibold text-danger-fg transition-colors hover:border-danger cursor-pointer"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Stop extraction</span>
          </button>
        </div>
      </div>
    </div>
  );
};

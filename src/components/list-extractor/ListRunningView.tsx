import React, { useMemo } from 'react';
import { ExternalLink, Pause, Play, X } from 'lucide-react';
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

function extractImage(record: ExtractedRecord): string | null {
  for (const [key, val] of Object.entries(record)) {
    if (typeof val === 'string') {
      if (/^https?:\/\/.+\.(jpg|jpeg|png|webp|avif|gif)(\?.*)?$/i.test(val)) {
        return val;
      }
      if (/(image|img|src|thumbnail|photo|picture)/i.test(key) && /^https?:\/\//i.test(val)) {
        return val;
      }
    }
  }
  return null;
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
  const elapsed = stats.elapsedSeconds || 0;
  const count = stats.totalExtracted || records.length;
  const speed = elapsed > 0 ? (count / elapsed).toFixed(1) : '0.0';

  // Smart Live Visual Feed analysis
  const recentRecords = useMemo(() => records.slice(-5), [records]);
  const imageUrls = useMemo(() => {
    return recentRecords.map(extractImage).filter((url): url is string => Boolean(url));
  }, [recentRecords]);

  const hasImages = imageUrls.length > 0;
  const recentSnippets = useMemo(() => {
    return records.slice(-3).map(extractPrimaryText);
  }, [records]);

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
        className="pointer-events-none absolute -top-16 left-1/2 -translate-x-1/2 h-56 w-56 rounded-full bg-[#00E599]/15 blur-3xl ph-aura-breathe"
        aria-hidden="true"
      />

      {/* Header Info */}
      <div className="flex items-center justify-between text-2xs z-10">
        <span className="font-bold uppercase tracking-wider text-[#00E599]">
          Live Extraction Stage
        </span>
        <span className="flex items-center gap-1.5 font-medium text-fg-subtle">
          <span
            className={`h-2 w-2 rounded-full ${
              isPaused ? 'bg-warning' : 'bg-[#00E599] animate-pulse'
            }`}
          />
          {isPaused ? 'Extraction Paused' : 'Harvesting page…'}
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
              stroke="rgba(255, 255, 255, 0.08)"
              strokeWidth="6"
              fill="none"
            />
            {/* Animated rotating emerald arc */}
            <circle
              cx="70"
              cy="70"
              r="58"
              stroke="#00E599"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray="110 254"
              fill="none"
              className={isPaused ? '' : 'ph-ring-spin'}
              style={{
                filter: 'drop-shadow(0 0 8px rgba(0, 229, 153, 0.5))',
              }}
            />
          </svg>

          {/* Upright Center Counter */}
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-3xl font-extrabold tracking-tight text-fg tabular-nums">
              {count.toLocaleString('en-US')}
            </span>
            <span className="text-[9px] font-bold tracking-widest text-[#00E599]/90 uppercase mt-0.5">
              ITEMS EXTRACTED
            </span>
          </div>
        </div>
      </div>

      {/* Smart Live Visual Feed */}
      <div className="flex flex-col gap-1.5 z-10">
        <div className="flex items-center justify-between text-3xs font-semibold text-fg-subtle uppercase tracking-wider">
          <span>Live Preview Feed</span>
          <span>{hasImages ? 'Media detection' : 'Text streaming'}</span>
        </div>

        {hasImages ? (
          /* 5-tile horizontal rounded thumbnail strip */
          <div className="grid grid-cols-5 gap-2">
            {[0, 1, 2, 3, 4].map((slotIdx) => {
              const url = imageUrls[slotIdx];
              return url ? (
                <div
                  key={slotIdx}
                  className="relative aspect-square w-full overflow-hidden rounded-xl border border-[#00E599]/25 bg-[#10141D] ph-pop-in"
                >
                  <img
                    src={url}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-[#00E599]/5" />
                </div>
              ) : (
                <div
                  key={slotIdx}
                  className="aspect-square w-full rounded-xl border border-line-subtle bg-[#10141D] ph-shimmer"
                />
              );
            })}
          </div>
        ) : (
          /* 3-row sliding mini-ticker */
          <div className="flex flex-col gap-1.5">
            {recentSnippets.length > 0 ? (
              recentSnippets.map((snippet, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 rounded-xl border border-line-subtle bg-[#10141D] px-3 py-1.5 text-xs text-fg-muted truncate ph-pop-in"
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#00E599]" />
                  <span className="truncate">{snippet}</span>
                </div>
              ))
            ) : (
              <div className="flex items-center gap-2 rounded-xl border border-line-subtle bg-[#10141D] px-3 py-2 text-xs text-fg-subtle ph-shimmer">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#00E599]/40" />
                <span>Waiting for page batches…</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 3-Column Telemetry Card */}
      <div className="grid grid-cols-3 divide-x divide-line-subtle rounded-2xl border border-line bg-[#10141D] p-3 text-center z-10 shadow-sm">
        <div className="flex flex-col items-center">
          <span className="text-3xs font-semibold tracking-wider text-fg-subtle uppercase">
            ELAPSED
          </span>
          <span className="text-sm font-bold text-fg tabular-nums mt-0.5">
            {formatElapsed(elapsed)}
          </span>
        </div>

        <div className="flex flex-col items-center">
          <span className="text-3xs font-semibold tracking-wider text-fg-subtle uppercase">
            SPEED
          </span>
          <span className="text-sm font-bold text-fg tabular-nums mt-0.5">
            {speed}/s
          </span>
        </div>

        <div className="flex flex-col items-center">
          <span className="text-3xs font-semibold tracking-wider text-fg-subtle uppercase">
            STATUS
          </span>
          <span
            className={`text-sm font-bold mt-0.5 ${
              isPaused ? 'text-warning-fg' : 'text-[#00E599]'
            }`}
          >
            {isPaused ? 'Paused' : 'Local ✓'}
          </span>
        </div>
      </div>

      {/* Bottom Action Stack */}
      <div className="mt-auto flex flex-col gap-2 pt-2 z-10">
        <button
          type="button"
          onClick={handleOpenLiveWorkbench}
          className="flex items-center justify-between rounded-xl border border-[#00E599]/40 bg-[#00E599]/10 py-2.5 px-3.5 text-xs font-semibold text-[#00E599] shadow-[0_0_16px_rgba(0,229,153,0.12)] transition-all hover:bg-[#00E599]/20 active:scale-[0.99] cursor-pointer"
        >
          <span className="flex items-center gap-1.5">
            <span>View results live</span>
            <ExternalLink className="h-3 w-3" />
          </span>
          <span className="rounded-full bg-[#00E599]/20 px-2 py-0.5 text-3xs font-bold text-[#00E599] tabular-nums">
            {count}
          </span>
        </button>

        <div className="flex items-center gap-2">
          {isPaused ? (
            <button
              type="button"
              onClick={onResume}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-[#00E599]/40 bg-[#00E599]/15 py-2 px-3 text-xs font-bold text-[#00E599] transition-colors hover:bg-[#00E599]/25 cursor-pointer"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              <span>Resume</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onPause}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-line bg-[#10141D] py-2 px-3 text-xs font-semibold text-fg transition-colors hover:border-line-strong cursor-pointer"
            >
              <Pause className="h-3.5 w-3.5 fill-current" />
              <span>Pause</span>
            </button>
          )}

          <button
            type="button"
            onClick={onStop}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-danger-line bg-danger-soft py-2 px-3 text-xs font-semibold text-danger-fg transition-colors hover:border-danger cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
            <span>Stop extraction</span>
          </button>
        </div>
      </div>
    </div>
  );
};

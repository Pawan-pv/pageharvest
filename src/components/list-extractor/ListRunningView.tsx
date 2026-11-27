import React, { useMemo } from 'react';
import { ExternalLink, Pause, Play, X } from 'lucide-react';
import {
  HarvestProgressStage,
  recordsToConveyorItems,
} from '@/components/shared/HarvestProgressStage';
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
  const elapsed = stats.elapsedSeconds || 0;
  const count = stats.totalExtracted || records.length;

  const conveyorItems = useMemo(() => recordsToConveyorItems(records, 4), [records]);

  const stageStatus = isFailed ? 'failed' : isPaused ? 'paused' : 'running';

  const progressSummary =
    stats.progressKind !== 'single' && stats.targetSteps > 0
      ? stats.progressKind === 'scrolls'
        ? `Scroll ${stats.currentStep} of ${stats.targetSteps}`
        : `Page ${stats.currentStep} of ${stats.targetSteps}`
      : undefined;

  const progressPercent =
    stats.progressKind !== 'single' && stats.targetSteps > 0
      ? Math.min(100, Math.round((stats.currentStep / stats.targetSteps) * 100))
      : undefined;

  const handleOpenLiveWorkbench = () => {
    if (dataset?.id) {
      void openWorkbench({ datasetId: dataset.id });
    } else {
      void openWorkbench();
    }
  };

  return (
    <div className="relative flex min-h-[460px] flex-col gap-5 p-4 text-left">
      <HarvestProgressStage
        count={count}
        metricLabel="ITEMS EXTRACTED"
        status={stageStatus}
        stageLabel="Live Extraction Stage"
        elapsedSeconds={elapsed}
        progressSummary={progressSummary}
        progressPercent={progressPercent}
        pacingNotice={isPaused ? 'Paused — press Resume to continue' : undefined}
        errorMessage={stats.errorMessage}
        conveyorItems={conveyorItems}
        feedLabel="Live Preview Feed"
        emptyFeedText="Waiting for page batches…"
      />

      {/* Bottom Action Stack */}
      <div className="z-10 mt-auto flex flex-col gap-2 pt-2">
        <button
          type="button"
          onClick={handleOpenLiveWorkbench}
          className="flex min-h-10 items-center justify-between rounded-xl border border-brand/40 bg-brand-soft px-3.5 py-2.5 text-body font-semibold text-brand-fg shadow-glow-emerald transition-all hover:bg-brand/20 hover:text-brand-emphasis active:scale-[0.99] cursor-pointer"
        >
          <span className="flex items-center gap-1.5">
            <span>View results live</span>
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
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
                className="flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-brand/40 bg-brand-soft px-3 py-2 text-body font-bold text-brand-fg transition-colors hover:bg-brand/20 hover:text-brand-emphasis cursor-pointer"
              >
                <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                <span>Resume</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onPause}
                className="flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-body font-semibold text-fg transition-colors hover:border-line-strong cursor-pointer ph-card-elevated"
              >
                <Pause className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                <span>Pause</span>
              </button>
            ))}

          <button
            type="button"
            onClick={onStop}
            className="flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-danger-line bg-danger-soft px-3 py-2 text-body font-semibold text-danger-fg transition-colors hover:border-danger cursor-pointer"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Stop extraction</span>
          </button>
        </div>
      </div>
    </div>
  );
};

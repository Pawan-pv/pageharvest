import React, { useEffect, useId, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import type { ExtractedRecord } from '@/types';

export type HarvestStageStatus = 'running' | 'paused' | 'failed' | 'completed';

export interface HarvestConveyorItem {
  id: string;
  primary: string;
  pills?: string[];
}

export interface HarvestProgressStageProps {
  /** Primary numeric count shown inside the 148x148 Harvest Reactor ring */
  count: number;
  /** Uppercase metric label under the hero count, e.g. "ITEMS EXTRACTED", "EMAILS FOUND" */
  metricLabel: string;
  /** Current stage status */
  status: HarvestStageStatus;
  /** Header eyebrow label */
  stageLabel?: string;
  /** Header status text */
  statusLabel?: string;
  /** Elapsed seconds; when omitted, tracks elapsed time automatically while running */
  elapsedSeconds?: number;
  /** Optional custom speed string */
  speedText?: string;
  /** Optional progress text shown in the pacing strip (e.g. "Progress: 1 / 3") */
  progressSummary?: string;
  /** Optional 0..100 progress percentage */
  progressPercent?: number;
  /** Optional pacing/waiting notice */
  pacingNotice?: string;
  /** Optional error message when status === 'failed' */
  errorMessage?: string | null;
  /** Latest captured records for the Live "Harvest Conveyor" Feed (zero <img> tags) */
  conveyorItems?: HarvestConveyorItem[];
  /** Label above the conveyor feed */
  feedLabel?: string;
  /** Empty conveyor message */
  emptyFeedText?: string;
  /** Whether to show the ambient header row */
  compact?: boolean;
  /** Optional extra content below the telemetry strip */
  children?: React.ReactNode;
}

export function formatElapsedSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|svg|avif)(?:[?#].*)?$/i;
const SKIP_PILL_KEY_RE = /(?:image|img|thumb|avatar|photo|html)/i;

function toPillValue(key: string, val: unknown): string | null {
  if (val === null || val === undefined) return null;
  if (SKIP_PILL_KEY_RE.test(key)) return null;
  const str = String(val).trim();
  if (!str || str.startsWith('<') || IMAGE_EXT_RE.test(str)) return null;
  if (/^https?:\/\//i.test(str)) {
    try {
      return new URL(str).hostname;
    } catch {
      return null;
    }
  }
  return str.length > 24 ? `${str.slice(0, 22)}…` : str;
}

export function recordsToConveyorItems(records: ExtractedRecord[], limit = 4): HarvestConveyorItem[] {
  const seenCounts = new Map<string, number>();
  return records
    .slice(-limit)
    .reverse()
    .map((rec) => {
      let primary = '';
      const pills: string[] = [];
      for (const [key, val] of Object.entries(rec)) {
        if (key === 'id' || key === 'datasetId' || key.startsWith('_')) continue;
        if (SKIP_PILL_KEY_RE.test(key)) continue;
        const str = typeof val === 'string' || typeof val === 'number' ? String(val).trim() : '';
        if (!str || str.startsWith('<')) continue;
        if (!primary && !IMAGE_EXT_RE.test(str) && !/^https?:\/\//i.test(str)) {
          primary = str;
          continue;
        }
        if (pills.length < 2) {
          const pill = toPillValue(key, val);
          if (pill && pill !== primary) pills.push(pill);
        }
      }
      if (!primary) {
        for (const [key, val] of Object.entries(rec)) {
          if (key === 'id' || key === 'datasetId' || key.startsWith('_')) continue;
          if (SKIP_PILL_KEY_RE.test(key)) continue;
          if (typeof val === 'string' && val.trim() && !val.trim().startsWith('<')) {
            primary = val.trim();
            break;
          }
        }
      }
      const rawId = rec._id ?? rec.id;
      let id: string;
      if (rawId !== undefined && rawId !== null && String(rawId).trim()) {
        id = String(rawId);
      } else {
        const base = primary || 'captured';
        const seen = seenCounts.get(base) ?? 0;
        seenCounts.set(base, seen + 1);
        id = seen === 0 ? base : `${base}#${seen}`;
      }
      return {
        id,
        primary: primary || 'Captured item',
        pills,
      };
    });
}

export const HarvestProgressStage: React.FC<HarvestProgressStageProps> = ({
  count,
  metricLabel,
  status,
  stageLabel = 'Live Extraction Stage',
  statusLabel,
  elapsedSeconds,
  speedText,
  progressSummary,
  progressPercent,
  pacingNotice,
  errorMessage,
  conveyorItems = [],
  feedLabel = 'Harvest Conveyor',
  emptyFeedText = 'Waiting for page batches…',
  compact = false,
  children,
}) => {
  const gradientId = useId().replace(/:/g, '');
  const isRunning = status === 'running';
  const isPaused = status === 'paused';
  const isFailed = status === 'failed';
  const isCompleted = status === 'completed';

  // Internal elapsed seconds fallback for tool views that don't track a timer externally
  const [autoElapsed, setAutoElapsed] = useState(0);
  const prevStatusRef = useRef<HarvestStageStatus>(status);
  const isZeroCount = count === 0;
  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = status;
    if (elapsedSeconds !== undefined) return;
    if (isRunning && isZeroCount && prevStatus !== 'paused' && prevStatus !== 'running') {
      setAutoElapsed(0);
    }
    if (!isRunning) return;
    const id = setInterval(() => {
      setAutoElapsed((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [elapsedSeconds, isRunning, isZeroCount, status]);

  const elapsed = elapsedSeconds ?? autoElapsed;
  const computedSpeed = speedText ?? `${(elapsed > 0 ? count / elapsed : 0).toFixed(1)}/s`;

  // Keyed reactive pulse when extracted count increases
  const prevCountRef = useRef(count);
  const [pulseKey, setPulseKey] = useState(0);
  useEffect(() => {
    if (count > prevCountRef.current && isRunning) {
      setPulseKey((k) => k + 1);
    }
    prevCountRef.current = count;
  }, [count, isRunning]);

  // Throttled polite screen reader progress announcement
  const [liveAnnouncement, setLiveAnnouncement] = useState('');
  const lastAnnouncedAtRef = useRef(0);
  useEffect(() => {
    const now = Date.now();
    const stateWord = isFailed ? 'failed' : isPaused ? 'paused' : isCompleted ? 'complete' : 'running';
    const nextText = `${count.toLocaleString('en-US')} ${metricLabel.toLowerCase()}, ${stateWord}`;
    if (!isRunning || now - lastAnnouncedAtRef.current >= 1500 || lastAnnouncedAtRef.current === 0) {
      lastAnnouncedAtRef.current = now;
      setLiveAnnouncement(nextText);
    }
  }, [count, metricLabel, isRunning, isPaused, isFailed, isCompleted]);

  const resolvedStatusLabel =
    statusLabel ??
    (isFailed
      ? 'Extraction Failed'
      : isPaused
        ? 'Extraction Paused'
        : isCompleted
          ? 'Extraction Complete'
          : 'Harvesting page…');

  const visibleItems = conveyorItems.slice(0, 4);

  const arcStroke = isFailed
    ? 'rgb(var(--ph-danger))'
    : isPaused
      ? 'rgb(var(--ph-warning))'
      : `url(#${gradientId})`;

  const ringGlow = isFailed
    ? 'drop-shadow(0 0 8px rgb(var(--ph-danger) / 0.35))'
    : isPaused
      ? 'drop-shadow(0 0 8px rgb(var(--ph-warning) / 0.30))'
      : 'drop-shadow(0 0 10px rgb(var(--ph-brand) / 0.35))';

  return (
    <div className="relative flex flex-col gap-4 overflow-hidden text-left">
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {liveAnnouncement}
      </div>

      {/* Ambient top aura */}
      {!compact && (
        <div
          className={`pointer-events-none absolute -top-16 left-1/2 -translate-x-1/2 h-52 w-52 rounded-full ${
            isFailed ? 'bg-danger/10' : isPaused ? 'bg-warning/10' : 'bg-brand/15'
          } blur-3xl ${isRunning ? 'ph-aura-breathe motion-reduce:animate-none' : ''}`}
          aria-hidden="true"
        />
      )}

      {/* Stage Header */}
      <div className="z-10 flex items-center justify-between gap-2 text-2xs">
        <span className="ph-eyebrow text-brand-fg truncate">{stageLabel}</span>
        <span className="flex shrink-0 items-center gap-1.5 font-medium text-fg-subtle">
          <span
            className={`h-2 w-2 rounded-full ${
              isFailed
                ? 'bg-danger'
                : isPaused
                  ? 'bg-warning'
                  : isCompleted
                    ? 'bg-brand'
                    : 'bg-brand animate-pulse motion-reduce:animate-none'
            }`}
          />
          {resolvedStatusLabel}
        </span>
      </div>

      {/* Harvest Reactor SVG Ring (148x148) */}
      <div className="z-10 relative flex flex-col items-center justify-center py-1">
        <div className="relative flex h-[148px] w-[148px] items-center justify-center">
          {pulseKey > 0 && isRunning && (
            <div
              key={pulseKey}
              aria-hidden="true"
              className="pointer-events-none absolute inset-2 rounded-full border-2 border-brand/50 ph-harvest-pulse motion-reduce:animate-none"
            />
          )}

          <svg className="h-[148px] w-[148px]" viewBox="0 0 148 148" aria-hidden="true">
            <defs>
              <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="rgb(var(--ph-brand))" />
                <stop offset="100%" stopColor="rgb(var(--ph-tool-teal))" />
              </linearGradient>
            </defs>

            {/* Outer dashed orbital ring */}
            <circle
              cx="74"
              cy="74"
              r="69"
              stroke="rgb(var(--ph-line-strong) / 0.35)"
              strokeWidth="1.5"
              strokeDasharray="4 6"
              fill="none"
              className={isRunning ? 'ph-orbit-slow motion-reduce:animate-none' : ''}
            />

            {/* Middle track ring */}
            <circle cx="74" cy="74" r="58" stroke="rgb(var(--ph-line))" strokeWidth="6" fill="none" />

            {/* Comet arc (rotated group for -90deg start) */}
            <g transform="rotate(-90 74 74)">
              <circle
                cx="74"
                cy="74"
                r="58"
                stroke={arcStroke}
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={isCompleted ? '365 0' : '114 252'}
                fill="none"
                className={isRunning ? 'ph-ring-spin motion-reduce:animate-none' : ''}
                style={{ filter: ringGlow }}
              />
            </g>
          </svg>

          {/* Centered hero counter */}
          <div className="absolute inset-0 flex flex-col items-center justify-center px-3 text-center">
            <span
              key={count}
              className="text-3xl font-bold text-fg ph-display-num ph-tick-up motion-reduce:animate-none"
            >
              {count.toLocaleString('en-US')}
            </span>
            <span className="mt-0.5 text-2xs font-semibold uppercase tracking-[0.08em] text-brand-fg">
              {metricLabel}
            </span>
          </div>
        </div>
      </div>

      {/* Failure Alert */}
      {isFailed && errorMessage && (
        <div
          role="alert"
          className="z-10 rounded-xl border border-danger-line bg-danger-soft px-3 py-2 text-body font-medium text-danger-fg"
        >
          {errorMessage}
        </div>
      )}

      {/* Live "Harvest Conveyor" Feed (Zero <img> tags) */}
      <div className="z-10 flex flex-col gap-1.5">
        <div className="flex items-center justify-between ph-eyebrow">
          <span>{feedLabel}</span>
          <span>Text stream</span>
        </div>

        <div className="flex flex-col gap-1.5">
          {visibleItems.length > 0 ? (
            visibleItems.map((item, idx) => {
              const isNewest = idx === 0 && isRunning;
              return (
                <div
                  key={item.id}
                  className={`flex min-w-0 items-center justify-between gap-2 rounded-xl border px-3 py-1.5 ph-card-elevated ph-row-enter motion-reduce:animate-none ${
                    isNewest ? 'border-brand-line bg-brand-soft/50' : 'border-line-subtle bg-surface'
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        isNewest ? 'bg-brand' : 'bg-brand/45'
                      }`}
                    />
                    <span className="truncate text-body font-medium text-fg">{item.primary}</span>
                  </div>
                  {item.pills && item.pills.length > 0 && (
                    <div className="flex shrink-0 items-center gap-1">
                      {item.pills.slice(0, 2).map((pill, pIdx) => (
                        <span
                          key={pIdx}
                          className="max-w-[84px] truncate rounded-full border border-line-subtle bg-surface-muted px-1.5 py-0.5 text-2xs font-medium ph-tabular text-fg-muted"
                        >
                          {pill}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div
              className={`flex items-center gap-2 rounded-xl border border-line-subtle bg-surface px-3 py-2 text-body text-fg-subtle ph-card-elevated ${
                isFailed || isCompleted ? '' : 'ph-shimmer motion-reduce:animate-none'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  isFailed ? 'bg-danger/60' : isPaused ? 'bg-warning' : 'bg-brand/40'
                }`}
              />
              <span className="truncate">
                {isFailed ? 'No items captured.' : isPaused ? 'Paused — waiting to resume.' : emptyFeedText}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 3-Column Telemetry Strip with scan-beam / calm pacing top edge */}
      <div className="z-10 relative overflow-hidden rounded-xl border border-line bg-surface ph-card-elevated">
        {(isRunning || isPaused) && (
          <div className="relative h-0.5 w-full overflow-hidden bg-surface-muted" aria-hidden="true">
            {isRunning ? (
              <span className="block h-full w-2/5 ph-scan-beam motion-reduce:animate-none" />
            ) : (
              <span className="block h-full w-full bg-warning/70" />
            )}
          </div>
        )}

        {(progressSummary || pacingNotice) && (
          <div className="flex flex-col gap-1 border-b border-line-subtle px-3 py-2">
            {progressSummary && (
              <div className="flex items-center justify-between gap-2 text-2xs font-semibold text-fg-muted">
                <span className="truncate ph-tabular">{progressSummary}</span>
                {progressPercent !== undefined && (
                  <span className="shrink-0 ph-tabular text-brand-fg">{progressPercent}%</span>
                )}
              </div>
            )}
            {progressPercent !== undefined && (
              <div className="h-1 w-full overflow-hidden rounded-full bg-surface-muted">
                <div
                  className={`h-full transition-all duration-300 ${isPaused ? 'bg-warning' : 'bg-brand'}`}
                  style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }}
                />
              </div>
            )}
            {pacingNotice && (
              <p className="text-2xs text-fg-subtle truncate">{pacingNotice}</p>
            )}
          </div>
        )}

        <div className="grid grid-cols-3 divide-x divide-line-subtle p-3 text-center">
          <div className="flex min-w-0 flex-col items-center px-1">
            <span className="ph-eyebrow">
              ELAPSED
            </span>
            <span className="mt-0.5 text-sm font-semibold text-fg ph-tabular">
              {formatElapsedSeconds(elapsed)}
            </span>
          </div>

          <div className="flex min-w-0 flex-col items-center px-1">
            <span className="ph-eyebrow">
              SPEED
            </span>
            <span className="mt-0.5 text-sm font-semibold text-fg ph-tabular">
              {computedSpeed}
            </span>
          </div>

          <div className="flex min-w-0 flex-col items-center px-1">
            <span className="ph-eyebrow">
              STATUS
            </span>
            <span
              className={`mt-0.5 text-sm font-semibold ${
                isFailed
                  ? 'text-danger-fg'
                  : isPaused
                    ? 'text-warning-fg'
                    : 'text-brand-fg'
              }`}
            >
              {isFailed ? (
                'Failed'
              ) : isPaused ? (
                'Paused'
              ) : isCompleted ? (
                'Done'
              ) : (
                <span className="inline-flex items-center justify-center gap-1">
                  <span>Local</span>
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
              )}
            </span>
          </div>
        </div>
      </div>

      {children}
    </div>
  );
};

import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Database,
  ExternalLink,
  Layers,
  Mail,
  Pause,
  Play,
  Settings2,
  StopCircle,
} from 'lucide-react';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { Banner } from '@/components/common/Banner';
import { HarvestProgressStage, type HarvestConveyorItem } from '@/components/shared/HarvestProgressStage';
import { readUrlHandoff, clearUrlHandoff } from '@/platform/url-handoff';
import { openWorkbench } from '@/platform/workbench';
import { useDatasets } from '@/hooks/useDatasets';
import { messagingService } from '@/services/messaging';
import { createEmailExtractorRunner } from '@/background/runners/email-runner';
import type { TabWorkerPool } from '@/background/tab-worker-pool';
import type { ToolJobProgress, UrlHandoff } from '@/shared/contracts/tool-job';
import type { ExtractedRecord, FieldDefinition } from '@/types';

export interface EmailExtractorViewProps {
  onBack?: () => void;
  onOpenTable?: (datasetId: string) => void;
}

export const EmailExtractorView: React.FC<EmailExtractorViewProps> = ({ onBack, onOpenTable }) => {
  const { datasets, getDatasetRecords } = useDatasets();

  // ① URLs Source
  const [handoff, setHandoff] = useState<UrlHandoff | null>(null);
  const [rawUrls, setRawUrls] = useState('');
  const [selectedDatasetId, setSelectedDatasetId] = useState('');

  // ② Crawl & Extraction Settings
  const [depth, setDepth] = useState<number>(1);
  const [maxSubpages, setMaxSubpages] = useState<number>(4);
  const [deduplicate, setDeduplicate] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [concurrency, setConcurrency] = useState(2);
  const [minDelayMs, setMinDelayMs] = useState(1000);

  // ③ Live Run State
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState<ToolJobProgress | null>(null);
  const [previewRows, setPreviewRows] = useState<ExtractedRecord[]>([]);
  const [createdDatasetId, setCreatedDatasetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const poolRef = useRef<TabWorkerPool | null>(null);

  useEffect(() => {
    let live = true;
    void readUrlHandoff('email').then((stored) => {
      if (!live || !stored) return;
      setHandoff(stored);
      setRawUrls(stored.urls.join('\n'));
    });
    return () => {
      live = false;
      poolRef.current?.cancel();
    };
  }, []);

  const parsedUrls = rawUrls
    .split('\n')
    .map((u) => u.trim())
    .filter((u) => u.startsWith('http://') || u.startsWith('https://'));

  const handleDatasetChange = async (dsId: string) => {
    setSelectedDatasetId(dsId);
    if (!dsId) return;

    const ds = datasets.find((d) => d.id === dsId);
    if (!ds) return;

    const urlField = ds.fields.find(
      (f) => f.name.toLowerCase().includes('url') || f.name.toLowerCase().includes('link')
    ) ?? ds.fields[0];

    if (urlField) {
      try {
        const records = await getDatasetRecords(dsId);
        const urls = records
          .map((r: ExtractedRecord) => String(r[urlField.name] ?? '').trim())
          .filter((u: string) => u.startsWith('http://') || u.startsWith('https://'));
        setRawUrls(urls.join('\n'));
      } catch {
        // Ignore
      }
    }
  };

  const handleDismissHandoff = async () => {
    await clearUrlHandoff('email');
    setHandoff(null);
  };

  const handleStart = async () => {
    if (parsedUrls.length === 0 || isRunning) return;

    setError(null);
    setPreviewRows([]);
    setProgress(null);
    setIsRunning(true);
    setIsPaused(false);

    try {
      const firstUrl = parsedUrls[0];
      const host = new URL(firstUrl).hostname;
      const name = `Emails - ${host} (${parsedUrls.length} URLs)`;

      const fields: FieldDefinition[] = [
        { id: 'f_email', name: 'Email', selector: 'Email', extractor: 'text', transform: 'trim', required: true },
        { id: 'f_domain', name: 'Domain', selector: 'Domain', extractor: 'text', transform: 'trim', required: false },
        { id: 'f_found_via', name: 'Found Via', selector: 'Found Via', extractor: 'text', transform: 'trim', required: false },
        { id: 'f_source_page', name: 'Source Page', selector: 'Source Page', extractor: 'text', transform: 'trim', required: false },
        { id: 'f_origin', name: 'Website Origin', selector: 'Website Origin', extractor: 'text', transform: 'trim', required: false },
        { id: 'f_title', name: 'Page Title', selector: 'Page Title', extractor: 'text', transform: 'trim', required: false },
        { id: 'f_depth', name: 'Depth', selector: 'Depth', extractor: 'number', transform: 'trim', required: false },
      ];

      const dsId = await messagingService.createDataset(name, firstUrl, fields, []);
      setCreatedDatasetId(dsId);

      const pool = createEmailExtractorRunner({
        urls: parsedUrls,
        datasetId: dsId,
        depth,
        maxSubpagesPerSite: maxSubpages,
        concurrency,
        minDelayMs,
        deduplicate,
        onProgress: (p) => setProgress(p),
        onRowExtracted: (record) => {
          setPreviewRows((prev) => [record, ...prev].slice(0, 4));
        },
      });

      poolRef.current = pool;
      await pool.run();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
      setIsPaused(false);
      poolRef.current = null;
    }
  };

  const handlePauseResume = () => {
    if (!poolRef.current) return;
    if (isPaused) {
      poolRef.current.resume();
      setIsPaused(false);
    } else {
      poolRef.current.pause();
      setIsPaused(true);
    }
  };

  const handleStop = () => {
    poolRef.current?.cancel();
    setIsRunning(false);
    setIsPaused(false);
  };

  return (
    <div className="flex flex-col gap-3 p-1">
      {/* Top Header */}
      <div className="flex items-center justify-between pb-1">
        <div className="flex items-center gap-2">
          {onBack && (
            <Button
              variant="ghost"
              size="sm"
              iconLeft={<ArrowLeft className="h-4 w-4" />}
              onClick={onBack}
              aria-label="Back to tools"
            >
              Back
            </Button>
          )}
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-tool-emerald/15 text-tool-emerald">
              <Mail className="h-4 w-4" />
            </span>
            <h2 className="text-sm font-bold text-fg">Email Extractor</h2>
          </div>
        </div>

        {createdDatasetId && (
          <Button
            variant="ghost"
            size="sm"
            iconRight={<ExternalLink className="h-3.5 w-3.5" />}
            onClick={() => {
              if (onOpenTable) onOpenTable(createdDatasetId);
              else void openWorkbench({ datasetId: createdDatasetId });
            }}
          >
            Open Full Table ↗
          </Button>
        )}
      </div>

      {error && (
        <Banner tone="danger" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}

      {/* Piped URLs Handoff Banner */}
      {handoff && (
        <Banner
          tone="info"
          onDismiss={() => void handleDismissHandoff()}
        >
          Piped {handoff.urls.length} URLs from <strong>{handoff.source}</strong>.
        </Banner>
      )}

      {/* ① Section 1: URLs Source */}
      <Card className="flex flex-col gap-2.5 p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-fg">Target Websites / URLs</span>
          <span className="text-2xs text-fg-subtle">
            {parsedUrls.length} {parsedUrls.length === 1 ? 'URL' : 'URLs'} queued
          </span>
        </div>

        {/* Existing Dataset Selector */}
        {datasets.length > 0 && (
          <div className="flex items-center gap-2">
            <Database className="h-3.5 w-3.5 text-fg-subtle shrink-0" />
            <select
              value={selectedDatasetId}
              onChange={(e) => void handleDatasetChange(e.target.value)}
              disabled={isRunning}
              className="w-full rounded-xl border border-line bg-surface p-1.5 text-2xs text-fg"
            >
              <option value="">-- Load URLs from a saved dataset --</option>
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.recordsCount} rows)
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Textarea for direct URL paste */}
        <textarea
          rows={3}
          value={rawUrls}
          onChange={(e) => {
            setRawUrls(e.target.value);
            setSelectedDatasetId('');
          }}
          disabled={isRunning}
          placeholder="Paste addresses (https://example.com), one per line"
          className="w-full rounded-xl border border-line bg-surface p-2 text-2xs text-fg placeholder:text-fg-subtle focus:border-tool-emerald focus:outline-none"
        />
      </Card>

      {/* ② Section 2: Deep Scan & Settings */}
      <Card className="flex flex-col gap-2.5 p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-fg">Crawl & Extraction Scope</span>
          <button
            type="button"
            onClick={() => setShowSettings(!showSettings)}
            className="flex items-center gap-1 text-2xs font-medium text-tool-emerald hover:underline"
          >
            <Settings2 className="h-3 w-3" />
            <span>Options</span>
            {showSettings ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 text-2xs">
          <label className="flex items-center gap-2 text-fg cursor-pointer">
            <input
              type="checkbox"
              checked={depth >= 1}
              onChange={(e) => setDepth(e.target.checked ? 1 : 0)}
              disabled={isRunning}
              className="accent-tool-emerald"
            />
            <span>Follow contact / about subpages</span>
          </label>

          <label className="flex items-center gap-2 text-fg cursor-pointer">
            <input
              type="checkbox"
              checked={deduplicate}
              onChange={(e) => setDeduplicate(e.target.checked)}
              disabled={isRunning}
              className="accent-tool-emerald"
            />
            <span>Deduplicate emails</span>
          </label>
        </div>

        {showSettings && (
          <div className="border-t border-line/60 pt-2 flex flex-col gap-2 text-2xs text-fg">
            <div className="flex items-center justify-between">
              <span className="text-fg-muted">Max subpages per site:</span>
              <input
                type="number"
                min={1}
                max={10}
                value={maxSubpages}
                onChange={(e) => setMaxSubpages(Math.max(1, Math.min(10, Number(e.target.value))))}
                disabled={isRunning}
                className="w-16 rounded border border-line bg-surface p-1 text-center text-xs"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-fg-muted">Concurrency (workers):</span>
              <input
                type="number"
                min={1}
                max={5}
                value={concurrency}
                onChange={(e) => setConcurrency(Math.max(1, Math.min(5, Number(e.target.value))))}
                disabled={isRunning}
                className="w-16 rounded border border-line bg-surface p-1 text-center text-xs"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-fg-muted">Delay between calls (ms):</span>
              <input
                type="number"
                min={1000}
                step={250}
                value={minDelayMs}
                onChange={(e) => setMinDelayMs(Math.max(1000, Number(e.target.value)))}
                disabled={isRunning}
                className="w-20 rounded border border-line bg-surface p-1 text-center text-xs"
              />
            </div>
          </div>
        )}
      </Card>

      {/* ③ Section 3: Live Run Feed & Control */}
      <Card className="flex flex-col gap-2.5 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-fg">
            <Layers className="h-3.5 w-3.5 text-tool-emerald" />
            <span>Execution Control</span>
          </div>

          <div className="flex items-center gap-1.5">
            {!isRunning ? (
              <Button
                variant="primary"
                size="sm"
                iconLeft={<Play className="h-3.5 w-3.5" />}
                onClick={() => void handleStart()}
                disabled={parsedUrls.length === 0}
              >
                Start Extraction
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  iconLeft={isPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                  onClick={handlePauseResume}
                >
                  {isPaused ? 'Resume' : 'Pause'}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  iconLeft={<StopCircle className="h-3.5 w-3.5" />}
                  onClick={handleStop}
                >
                  Stop
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Progress Metrics */}
        {progress && (
          <HarvestProgressStage
            compact
            count={progress.rowsExtracted}
            metricLabel="EMAILS FOUND"
            status={error && !isRunning ? 'failed' : !isRunning ? 'completed' : isPaused ? 'paused' : 'running'}
            stageLabel="Email Discovery"
            statusLabel={
              error && !isRunning
                ? 'Extraction Failed'
                : isRunning
                  ? isPaused
                    ? 'Paused'
                    : 'Scanning pages…'
                  : 'Complete'
            }
            progressSummary={`Processed ${progress.processedUrls} of ${progress.totalUrls} URLs`}
            progressPercent={Math.min(
              100,
              Math.round(((progress.processedUrls + progress.failedUrls) / (progress.totalUrls || 1)) * 100)
            )}
            pacingNotice={
              isRunning
                ? 'Keep this panel or workbench tab open while running'
                : progress.failedUrls > 0
                  ? `${progress.failedUrls} URL(s) failed`
                  : undefined
            }
            errorMessage={error}
            conveyorItems={previewRows.map((row): HarvestConveyorItem => ({
              id: String(row._id ?? `${String(row.Email || '')}-${String(row['Source Page'] || '')}`),
              primary: String(row.Email || ''),
              pills: [String(row.Domain || ''), String(row['Found Via'] || '')].filter(Boolean),
            }))}
            feedLabel="Recent Discovered Emails"
            emptyFeedText="Scanning pages for email addresses…"
          />
        )}
      </Card>
    </div>
  );
};

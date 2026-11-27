import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Database,
  ExternalLink,
  FileText,
  Layers,
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
import { createPageTextRunner } from '@/background/runners/page-text-runner';
import type { TabWorkerPool } from '@/background/tab-worker-pool';
import type { ToolJobProgress, UrlHandoff } from '@/shared/contracts/tool-job';
import type { ExtractedRecord, FieldDefinition } from '@/types';

export interface PageTextExtractorViewProps {
  onBack?: () => void;
  onOpenTable?: (datasetId: string) => void;
}

export const PageTextExtractorView: React.FC<PageTextExtractorViewProps> = ({ onBack, onOpenTable }) => {
  const { datasets, getDatasetRecords } = useDatasets();

  // ① URLs Source
  const [handoff, setHandoff] = useState<UrlHandoff | null>(null);
  const [rawUrls, setRawUrls] = useState('');
  const [selectedDatasetId, setSelectedDatasetId] = useState('');

  // ② Formatting & Output Options
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [includeMarkdown, setIncludeMarkdown] = useState(true);
  const [includePlainText, setIncludePlainText] = useState(true);
  const [mode, setMode] = useState<'fast_fetch' | 'browser_tab'>('fast_fetch');
  const [showSettings, setShowSettings] = useState(false);
  const [concurrency, setConcurrency] = useState(2);
  const [minDelayMs, setMinDelayMs] = useState(1000);

  // ③ Live Run State
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState<ToolJobProgress | null>(null);
  const [previewRows, setPreviewRows] = useState<ExtractedRecord[]>([]);
  const [allExtractedRecords, setAllExtractedRecords] = useState<ExtractedRecord[]>([]);
  const [createdDatasetId, setCreatedDatasetId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const poolRef = useRef<TabWorkerPool | null>(null);

  useEffect(() => {
    let live = true;
    void readUrlHandoff('page_text').then((stored) => {
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
    await clearUrlHandoff('page_text');
    setHandoff(null);
  };

  const handleStart = async () => {
    if (parsedUrls.length === 0 || isRunning) return;

    setError(null);
    setPreviewRows([]);
    setAllExtractedRecords([]);
    setProgress(null);
    setIsRunning(true);
    setIsPaused(false);

    try {
      const firstUrl = parsedUrls[0];
      const host = new URL(firstUrl).hostname;
      const name = `Page Text - ${host} (${parsedUrls.length} URLs)`;

      const fields: FieldDefinition[] = [
        { id: 'f_url', name: 'URL', selector: 'URL', extractor: 'text', transform: 'trim', required: true },
        { id: 'f_title', name: 'Title', selector: 'Title', extractor: 'text', transform: 'trim', required: false },
        { id: 'f_excerpt', name: 'Excerpt', selector: 'Excerpt', extractor: 'text', transform: 'trim', required: false },
        { id: 'f_tokens', name: 'Estimated Tokens', selector: 'Estimated Tokens', extractor: 'number', transform: 'trim', required: false },
        { id: 'f_words', name: 'Word Count', selector: 'Word Count', extractor: 'number', transform: 'trim', required: false },
      ];

      if (includeMarkdown) {
        fields.push({ id: 'f_markdown', name: 'Markdown', selector: 'Markdown', extractor: 'text', transform: 'trim', required: false });
      }
      if (includePlainText) {
        fields.push({ id: 'f_plaintext', name: 'Plain Text', selector: 'Plain Text', extractor: 'text', transform: 'trim', required: false });
      }
      if (includeMetadata) {
        fields.push(
          { id: 'f_author', name: 'Author', selector: 'Author', extractor: 'text', transform: 'trim', required: false },
          { id: 'f_sitename', name: 'Site Name', selector: 'Site Name', extractor: 'text', transform: 'trim', required: false },
          { id: 'f_published', name: 'Published Time', selector: 'Published Time', extractor: 'text', transform: 'trim', required: false }
        );
      }

      const dsId = await messagingService.createDataset(name, firstUrl, fields, []);
      setCreatedDatasetId(dsId);

      const pool = createPageTextRunner({
        urls: parsedUrls,
        datasetId: dsId,
        includeMetadata,
        includeMarkdown,
        includePlainText,
        mode,
        concurrency,
        minDelayMs,
        onProgress: (p) => setProgress(p),
        onRowExtracted: (record) => {
          setPreviewRows((prev) => [record, ...prev].slice(0, 4));
          setAllExtractedRecords((prev) => [...prev, record]);
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

  const handleCopyAllMarkdown = async () => {
    if (allExtractedRecords.length === 0) return;
    const combined = allExtractedRecords
      .map((r) => {
        const title = String(r.Title || r.URL || 'Article');
        const content = String(r.Markdown || r['Plain Text'] || '');
        return `# ${title}\nSource: ${String(r.URL)}\n\n${content}\n\n---\n`;
      })
      .join('\n');

    try {
      await navigator.clipboard.writeText(combined);
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    } catch {
      // Ignore
    }
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
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-muted text-fg-muted">
              <FileText className="h-4 w-4" />
            </span>
            <h2 className="text-sm font-bold text-fg">Page Text Extractor</h2>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {allExtractedRecords.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              iconLeft={copiedAll ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              onClick={() => void handleCopyAllMarkdown()}
            >
              {copiedAll ? 'Copied' : 'Copy All MD'}
            </Button>
          )}

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
      </div>

      {error && (
        <Banner tone="danger" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}

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

        <textarea
          rows={3}
          value={rawUrls}
          onChange={(e) => {
            setRawUrls(e.target.value);
            setSelectedDatasetId('');
          }}
          disabled={isRunning}
          placeholder="Paste article URLs (https://example.com/post), one per line"
          className="w-full rounded-xl border border-line bg-surface p-2 text-2xs text-fg placeholder:text-fg-subtle focus:border-line-strong focus:outline-none"
        />
      </Card>

      {/* ② Section 2: Output Options & Speed */}
      <Card className="flex flex-col gap-2.5 p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-fg">Output Formats & Mode</span>
          <button
            type="button"
            onClick={() => setShowSettings(!showSettings)}
            className="flex items-center gap-1 text-2xs font-medium text-fg-muted hover:underline"
          >
            <Settings2 className="h-3 w-3" />
            <span>Options</span>
            {showSettings ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 text-2xs">
          <label className="flex items-center gap-1.5 text-fg cursor-pointer">
            <input
              type="checkbox"
              checked={includeMarkdown}
              onChange={(e) => setIncludeMarkdown(e.target.checked)}
              disabled={isRunning}
              className="accent-tool-emerald"
            />
            <span>Markdown</span>
          </label>
          <label className="flex items-center gap-1.5 text-fg cursor-pointer">
            <input
              type="checkbox"
              checked={includePlainText}
              onChange={(e) => setIncludePlainText(e.target.checked)}
              disabled={isRunning}
              className="accent-tool-emerald"
            />
            <span>Plain Text</span>
          </label>
          <label className="flex items-center gap-1.5 text-fg cursor-pointer">
            <input
              type="checkbox"
              checked={includeMetadata}
              onChange={(e) => setIncludeMetadata(e.target.checked)}
              disabled={isRunning}
              className="accent-tool-emerald"
            />
            <span>Metadata</span>
          </label>
        </div>

        {/* Fast Fetch vs Browser Tabs Mode */}
        <div className="flex items-center gap-3 pt-1 text-2xs text-fg">
          <span className="text-3xs uppercase tracking-wider text-fg-subtle">Engine:</span>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name="mode"
              checked={mode === 'fast_fetch'}
              onChange={() => setMode('fast_fetch')}
              disabled={isRunning}
              className="accent-tool-emerald"
            />
            <span>Fast Fetch</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name="mode"
              checked={mode === 'browser_tab'}
              onChange={() => setMode('browser_tab')}
              disabled={isRunning}
              className="accent-tool-emerald"
            />
            <span>Browser Tab (JS)</span>
          </label>
        </div>

        {showSettings && (
          <div className="border-t border-line/60 pt-2 flex flex-col gap-2 text-2xs text-fg">
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
            <Layers className="h-3.5 w-3.5 text-fg-muted" />
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
            metricLabel="PAGES SCANNED"
            status={error && !isRunning ? 'failed' : !isRunning ? 'completed' : isPaused ? 'paused' : 'running'}
            stageLabel="Page Text Extraction"
            statusLabel={isRunning ? (isPaused ? 'Paused' : 'Extracting text…') : 'Complete'}
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
            conveyorItems={previewRows.map((row, idx): HarvestConveyorItem => ({
              id: String(row._id ?? idx),
              primary: String(row.Title || row.URL || ''),
              pills: [row['Estimated Tokens'] ? `~${String(row['Estimated Tokens'])} tokens` : ''].filter(Boolean),
            }))}
            feedLabel="Recent Cleaned Articles"
            emptyFeedText="Extracting clean article text…"
          />
        )}
      </Card>
    </div>
  );
};

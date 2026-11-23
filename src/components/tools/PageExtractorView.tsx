import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Database,
  ExternalLink,
  Layers,
  Pause,
  Play,
  Plus,
  Settings2,
  StopCircle,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { Input } from '@/components/common/Input';
import { Banner } from '@/components/common/Banner';
import { readUrlHandoff, clearUrlHandoff } from '@/platform/url-handoff';
import { openWorkbench } from '@/platform/workbench';
import { useDatasets } from '@/hooks/useDatasets';
import { messagingService } from '@/services/messaging';
import { createPageExtractorRunner } from '@/background/runners/page-extractor-runner';
import type { TabWorkerPool } from '@/background/tab-worker-pool';
import type { CustomCssField, PageActionsConfig } from '@/core/page-extract/types';
import type { ToolJobProgress, UrlHandoff } from '@/shared/contracts/tool-job';
import type { ExtractedRecord, FieldDefinition } from '@/types';

export interface PageExtractorViewProps {
  onBack?: () => void;
  onOpenTable?: (datasetId: string) => void;
}

export const PageExtractorView: React.FC<PageExtractorViewProps> = ({ onBack, onOpenTable }) => {
  const { datasets, getDatasetRecords } = useDatasets();

  // ① URLs Source
  const [handoff, setHandoff] = useState<UrlHandoff | null>(null);
  const [rawUrls, setRawUrls] = useState('');
  const [selectedDatasetId, setSelectedDatasetId] = useState('');

  // ② What to Extract
  const [extractMetadata, setExtractMetadata] = useState(true);
  const [extractJsonLd, setExtractJsonLd] = useState(true);
  const [customFields, setCustomFields] = useState<CustomCssField[]>([]);
  const [showCustomFields, setShowCustomFields] = useState(false);
  const [showSpeedSettings, setShowSpeedSettings] = useState(false);

  // Speed & Mode
  const [mode, setMode] = useState<'fast_fetch' | 'browser_tab'>('fast_fetch');
  const [concurrency, setConcurrency] = useState(2);
  const [minDelayMs, setMinDelayMs] = useState(1000);
  const [pageActions] = useState<PageActionsConfig>({
    waitMs: 0,
    scrollToBottom: false,
    clickSelector: '',
  });

  // ③ Live Run Panel
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState<ToolJobProgress | null>(null);
  const [previewRows, setPreviewRows] = useState<ExtractedRecord[]>([]);
  const [createdDatasetId, setCreatedDatasetId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const poolRef = useRef<TabWorkerPool | null>(null);

  // Auto-load handoff URLs
  useEffect(() => {
    let live = true;
    void readUrlHandoff('page').then((stored) => {
      if (!live || !stored) return;
      setHandoff(stored);
      setRawUrls(stored.urls.join('\n'));
    });
    return () => {
      live = false;
      poolRef.current?.cancel();
    };
  }, []);

  const parsedUrls = useMemoUrls(rawUrls);

  function useMemoUrls(text: string): string[] {
    return text
      .split('\n')
      .map((u) => u.trim())
      .filter((u) => u.startsWith('http://') || u.startsWith('https://'));
  }

  // Handle column selection from existing dataset
  const handleDatasetChange = async (dsId: string) => {
    setSelectedDatasetId(dsId);
    if (!dsId) return;

    const ds = datasets.find((d) => d.id === dsId);
    if (!ds) return;

    // Pick first URL column
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

  const addCustomField = () => {
    setCustomFields((prev) => [
      ...prev,
      { name: `Field_${prev.length + 1}`, selector: '', attribute: 'text' },
    ]);
    setShowCustomFields(true);
  };

  const removeCustomField = (index: number) => {
    setCustomFields((prev) => prev.filter((_, i) => i !== index));
  };

  const updateCustomField = (index: number, patch: Partial<CustomCssField>) => {
    setCustomFields((prev) =>
      prev.map((f, i) => (i === index ? { ...f, ...patch } : f))
    );
  };

  const handleTestFirstUrl = async () => {
    if (parsedUrls.length === 0) return;
    setTestResult(null);
    setError(null);

    const testUrl = parsedUrls[0];
    try {
      const response = await fetch(testUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const html = await response.text();
      const titleMatch = html.match(/<title(?:\s+[^>]*)?>([\s\S]*?)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : 'No title found';
      setTestResult(`Success on ${testUrl} — Title: "${title}" (${html.length} bytes read)`);
    } catch (err: unknown) {
      setError(`Test failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleStart = async () => {
    if (parsedUrls.length === 0 || isRunning) return;
    setError(null);
    setPreviewRows([]);
    setCreatedDatasetId(null);
    setIsRunning(true);
    setIsPaused(false);

    try {
      // 1. Create dataset via background single-writer
      const firstUrl = parsedUrls[0];
      const host = new URL(firstUrl).hostname;
      const name = `Page Details - ${host} (${parsedUrls.length} URLs)`;

      const fields: FieldDefinition[] = [
        { id: 'f_url', name: 'URL', selector: 'URL', extractor: 'text', transform: 'trim', required: true },
      ];
      if (extractMetadata) {
        fields.push(
          { id: 'f_title', name: 'Title', selector: 'title', extractor: 'text', transform: 'trim', required: false },
          { id: 'f_desc', name: 'Description', selector: 'description', extractor: 'text', transform: 'trim', required: false },
          { id: 'f_canon', name: 'Canonical', selector: 'canonical', extractor: 'text', transform: 'trim', required: false },
          { id: 'f_og_title', name: 'OG Title', selector: 'ogTitle', extractor: 'text', transform: 'trim', required: false },
          { id: 'f_og_image', name: 'OG Image', selector: 'ogImage', extractor: 'text', transform: 'trim', required: false },
          { id: 'f_author', name: 'Author', selector: 'author', extractor: 'text', transform: 'trim', required: false }
        );
      }
      if (extractJsonLd) {
        fields.push(
          { id: 'f_schema', name: 'Schema Type', selector: 'schemaType', extractor: 'text', transform: 'trim', required: false },
          { id: 'f_name', name: 'Schema Name', selector: 'name', extractor: 'text', transform: 'trim', required: false },
          { id: 'f_price', name: 'Price', selector: 'price', extractor: 'text', transform: 'trim', required: false },
          { id: 'f_sku', name: 'SKU', selector: 'sku', extractor: 'text', transform: 'trim', required: false }
        );
      }
      for (const cf of customFields) {
        if (cf.name) {
          fields.push({
            id: `f_custom_${cf.name}`,
            name: cf.name,
            selector: cf.selector,
            extractor: 'text',
            transform: 'trim',
            required: false,
          });
        }
      }

      const dsId = await messagingService.createDataset(name, firstUrl, fields, []);
      setCreatedDatasetId(dsId);

      // 2. Start TabWorkerPool
      const pool = createPageExtractorRunner({
        urls: parsedUrls,
        extractMetadata,
        extractJsonLd,
        customFields,
        pageActions,
        mode,
        concurrency,
        minDelayMs,
        datasetId: dsId,
        onProgress: (p) => setProgress(p),
        onRowExtracted: (row) => {
          setPreviewRows((prev) => [row, ...prev].slice(0, 3));
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

  const handleOpenWorkbench = () => {
    if (createdDatasetId) {
      if (onOpenTable) onOpenTable(createdDatasetId);
      else void openWorkbench({ datasetId: createdDatasetId });
    }
  };

  return (
    <div className="flex flex-col gap-3.5 p-4 text-left font-sans">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-line/60 pb-3">
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-line bg-surface text-fg-muted hover:text-fg"
              aria-label="Back to tools"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </button>
          )}
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-tool-sky/25 bg-tool-sky/15 text-tool-sky"
          >
            <Database className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-bold tracking-tight text-fg">Page Extractor 2.0</h2>
            <p className="text-2xs text-fg-subtle">Extract metadata, JSON-LD, and custom fields across multiple URLs</p>
          </div>
        </div>
      </div>

      {error && (
        <Banner tone="danger" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}

      {handoff && (
        <Banner tone="info" onDismiss={() => void clearUrlHandoff('page').then(() => setHandoff(null))}>
          <div className="flex items-center justify-between gap-2">
            <span>
              Received {handoff.urls.length} URLs from {handoff.source}.
            </span>
          </div>
        </Banner>
      )}

      {/* SECTION ①: URLs Source */}
      <Card className="flex flex-col gap-2.5 p-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-fg">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-tool-sky/20 text-3xs font-black text-tool-sky">
              1
            </span>
            Target URLs ({parsedUrls.length})
          </span>

          {datasets.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-3xs text-fg-subtle">Or pick dataset:</span>
              <select
                value={selectedDatasetId}
                onChange={(e) => void handleDatasetChange(e.target.value)}
                className="rounded-lg border border-line bg-surface px-1.5 py-0.5 text-2xs text-fg"
                disabled={isRunning}
              >
                <option value="">Choose dataset…</option>
                {datasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <textarea
          rows={3}
          value={rawUrls}
          onChange={(e) => setRawUrls(e.target.value)}
          placeholder="Paste URLs here, one per line (https://...)"
          disabled={isRunning}
          className="w-full rounded-xl border border-line bg-surface-sunken p-2 font-mono text-2xs text-fg placeholder:text-fg-subtle focus:border-tool-sky focus:outline-hidden"
        />
      </Card>

      {/* SECTION ②: What to Extract */}
      <Card className="flex flex-col gap-2.5 p-3">
        <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-fg">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-tool-sky/20 text-3xs font-black text-tool-sky">
            2
          </span>
          What to Extract
        </span>

        {/* Standard Toggles */}
        <div className="grid grid-cols-2 gap-2">
          <label className="flex items-center gap-2 rounded-xl border border-line/60 bg-surface p-2 text-2xs font-medium text-fg cursor-pointer">
            <input
              type="checkbox"
              checked={extractMetadata}
              onChange={(e) => setExtractMetadata(e.target.checked)}
              disabled={isRunning}
              className="rounded-sm accent-tool-sky"
            />
            <span>Page Metadata (Title, OG, Author)</span>
          </label>

          <label className="flex items-center gap-2 rounded-xl border border-line/60 bg-surface p-2 text-2xs font-medium text-fg cursor-pointer">
            <input
              type="checkbox"
              checked={extractJsonLd}
              onChange={(e) => setExtractJsonLd(e.target.checked)}
              disabled={isRunning}
              className="rounded-sm accent-tool-sky"
            />
            <span>Structured Data (JSON-LD Product/Schema)</span>
          </label>
        </div>

        {/* Collapsible: Custom CSS Fields */}
        <div className="rounded-xl border border-line/60 bg-surface">
          <button
            type="button"
            onClick={() => setShowCustomFields((v) => !v)}
            className="flex w-full items-center justify-between p-2.5 text-left text-2xs font-semibold text-fg-muted hover:text-fg"
          >
            <span className="flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-tool-sky" />
              <span>Custom CSS Fields ({customFields.length})</span>
            </span>
            {showCustomFields ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>

          {showCustomFields && (
            <div className="flex flex-col gap-2 border-t border-line/40 p-2.5">
              {customFields.map((field, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Input
                    placeholder="Field name"
                    value={field.name}
                    onChange={(e) => updateCustomField(idx, { name: e.target.value })}
                    disabled={isRunning}
                    className="w-1/3 text-2xs"
                  />
                  <Input
                    placeholder="CSS selector (.price, #title)"
                    value={field.selector}
                    onChange={(e) => updateCustomField(idx, { selector: e.target.value })}
                    disabled={isRunning}
                    className="flex-1 text-2xs"
                  />
                  <select
                    value={field.attribute}
                    onChange={(e) => updateCustomField(idx, { attribute: e.target.value as CustomCssField['attribute'] })}
                    disabled={isRunning}
                    className="rounded-lg border border-line bg-surface px-1.5 py-1 text-2xs text-fg"
                  >
                    <option value="text">Text</option>
                    <option value="href">Href</option>
                    <option value="src">Src</option>
                    <option value="content">Content</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => removeCustomField(idx)}
                    disabled={isRunning}
                    className="text-fg-subtle hover:text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}

              <div className="flex items-center justify-between pt-1">
                <Button variant="ghost" size="xs" iconLeft={<Plus className="h-3 w-3" />} onClick={addCustomField}>
                  Add CSS Field
                </Button>
                {parsedUrls.length > 0 && (
                  <Button variant="outline" size="xs" onClick={() => void handleTestFirstUrl()}>
                    Test on first URL
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>

        {testResult && (
          <div className="rounded-xl border border-tool-sky/30 bg-tool-sky/10 p-2 text-2xs text-tool-sky">
            {testResult}
          </div>
        )}

        {/* Collapsible: Speed & Execution Settings */}
        <div className="rounded-xl border border-line/60 bg-surface">
          <button
            type="button"
            onClick={() => setShowSpeedSettings((v) => !v)}
            className="flex w-full items-center justify-between p-2.5 text-left text-2xs font-semibold text-fg-muted hover:text-fg"
          >
            <span className="flex items-center gap-1.5">
              <Settings2 className="h-3.5 w-3.5 text-tool-sky" />
              <span>Speed & Execution Mode ({mode === 'fast_fetch' ? 'Fast Fetch' : 'Browser Tabs'})</span>
            </span>
            {showSpeedSettings ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>

          {showSpeedSettings && (
            <div className="flex flex-col gap-2.5 border-t border-line/40 p-2.5 text-2xs">
              <div className="flex items-center justify-between">
                <span className="text-fg-muted">Execution Mode:</span>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name="extract-mode"
                      checked={mode === 'fast_fetch'}
                      onChange={() => setMode('fast_fetch')}
                      disabled={isRunning}
                      className="accent-tool-sky"
                    />
                    <span>Fast Fetch</span>
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name="extract-mode"
                      checked={mode === 'browser_tab'}
                      onChange={() => setMode('browser_tab')}
                      disabled={isRunning}
                      className="accent-tool-sky"
                    />
                    <span>Browser Tabs</span>
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-fg-muted">Concurrency (1–5):</span>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={concurrency}
                  onChange={(e) => setConcurrency(Math.max(1, Math.min(5, Number(e.target.value))))}
                  disabled={isRunning}
                  className="w-16 rounded-lg border border-line bg-surface p-1 text-right text-2xs text-fg"
                />
              </div>

              <div className="flex items-center justify-between">
                <span className="text-fg-muted">Min delay between requests:</span>
                <input
                  type="number"
                  min={1000}
                  step={500}
                  value={minDelayMs}
                  onChange={(e) => setMinDelayMs(Math.max(1000, Number(e.target.value)))}
                  disabled={isRunning}
                  className="w-20 rounded-lg border border-line bg-surface p-1 text-right text-2xs text-fg"
                />
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* SECTION ③: Live Run Panel */}
      <Card className="flex flex-col gap-2.5 p-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-fg">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-tool-sky/20 text-3xs font-black text-tool-sky">
              3
            </span>
            Live Run
          </span>

          <div className="flex items-center gap-2">
            {isRunning ? (
              <>
                <Button
                  variant="outline"
                  size="xs"
                  iconLeft={isPaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                  onClick={handlePauseResume}
                >
                  {isPaused ? 'Resume' : 'Pause'}
                </Button>
                <Button variant="danger" size="xs" iconLeft={<StopCircle className="h-3 w-3" />} onClick={handleStop}>
                  Stop
                </Button>
              </>
            ) : (
              <Button
                variant="primary"
                size="sm"
                iconLeft={<Play className="h-3.5 w-3.5" />}
                onClick={() => void handleStart()}
                disabled={parsedUrls.length === 0}
              >
                Start Extraction
              </Button>
            )}
          </div>
        </div>

        {/* Progress Display */}
        {progress && (
          <div className="flex flex-col gap-1.5 pt-1">
            <div className="flex items-center justify-between text-2xs font-semibold">
              <span className="text-fg">
                Progress: {progress.processedUrls} / {progress.totalUrls}
              </span>
              <span className="text-tool-sky">{progress.rowsExtracted} rows extracted</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
              <div
                className="h-full bg-tool-sky transition-all duration-300"
                style={{
                  width: `${Math.round((progress.processedUrls / Math.max(progress.totalUrls, 1)) * 100)}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Mini Preview Table */}
        {previewRows.length > 0 && (
          <div className="flex flex-col gap-1 pt-1">
            <span className="text-3xs uppercase tracking-wider text-fg-subtle">Recent Extracted Rows (Latest 3)</span>
            <div className="flex flex-col divide-y divide-line/40 rounded-xl border border-line bg-surface-sunken">
              {previewRows.map((row, idx) => (
                <div key={idx} className="flex flex-col p-2 text-2xs">
                  <span className="truncate font-semibold text-fg">{String(row['Title'] || row['Schema Name'] || row.URL)}</span>
                  <span className="truncate text-3xs text-fg-subtle">{row.URL}</span>
                  {row['Price'] && (
                    <span className="mt-0.5 text-3xs font-mono text-tool-emerald">
                      Price: {String(row['Price'])} {String(row['Currency'] || '')}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Finish Action */}
        {createdDatasetId && !isRunning && (
          <div className="flex items-center justify-between rounded-xl border border-tool-sky/30 bg-tool-sky/10 p-2.5">
            <span className="text-2xs font-semibold text-tool-sky">Extraction completed!</span>
            <Button
              variant="primary"
              size="xs"
              iconRight={<ExternalLink className="h-3 w-3" />}
              onClick={handleOpenWorkbench}
            >
              Open Full Table ↗
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
};

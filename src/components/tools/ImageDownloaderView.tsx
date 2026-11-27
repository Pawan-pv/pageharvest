import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  Filter,
  Image as ImageIcon,
  Layers,
  Loader2,
  Pause,
  Play,
  RotateCw,
  Square,
  StopCircle,
} from 'lucide-react';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { Banner } from '@/components/common/Banner';
import { openWorkbench } from '@/platform/workbench';
import { useDatasets } from '@/hooks/useDatasets';
import { useActiveTab } from '@/hooks/useActiveTab';
import { messagingService } from '@/services/messaging';
import { executePageImageScan } from '@/core/images/image-scanner';
import {
  extractImageExtension,
  interpolateFilenameTemplate,
  type ImageItem,
} from '@/core/images/image-utils';
import {
  ImageDownloaderRunner,
  type ImageDownloadProgress,
} from '@/background/runners/image-downloader-runner';
import type { ExtractedRecord, FieldDefinition } from '@/types';

export interface ImageDownloaderViewProps {
  initialDatasetId?: string;
  initialColumn?: string;
  onBack?: () => void;
  onOpenTable?: (datasetId: string) => void;
}

const FORMAT_OPTIONS = ['All', 'JPG', 'PNG', 'WEBP', 'SVG', 'GIF'];

export const ImageDownloaderView: React.FC<ImageDownloaderViewProps> = ({
  initialDatasetId,
  initialColumn,
  onBack,
  onOpenTable,
}) => {
  const { datasets, getDatasetRecords } = useDatasets();
  const { tab } = useActiveTab();

  // Mode: 'page' | 'dataset'
  const [sourceMode, setSourceMode] = useState<'page' | 'dataset'>(
    initialDatasetId ? 'dataset' : 'page'
  );
  const [autoScroll, setAutoScroll] = useState(true);

  // Dataset source selection
  const [selectedDatasetId, setSelectedDatasetId] = useState(initialDatasetId || '');
  const [selectedColumn, setSelectedColumn] = useState(initialColumn || '');
  const [datasetColumns, setDatasetColumns] = useState<string[]>([]);

  // Discovered images
  const [images, setImages] = useState<ImageItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isScanning, setIsScanning] = useState(false);

  // Filters
  const [minDimensionFilter, setMinDimensionFilter] = useState(true); // >= 100x100
  const [selectedFormat, setSelectedFormat] = useState('All');

  // Filename template
  const [template, setTemplate] = useState('{domain}/{alt}-{index}.{ext}');
  const [showTemplateTokens, setShowTemplateTokens] = useState(false);

  // Download runner state
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<ImageDownloadProgress | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [savedDatasetId, setSavedDatasetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runnerRef = useRef<ImageDownloaderRunner | null>(null);

  // Load dataset columns if dataset selected
  useEffect(() => {
    if (!selectedDatasetId) {
      setDatasetColumns([]);
      return;
    }
    const ds = datasets.find((d) => d.id === selectedDatasetId);
    if (!ds) return;

    const cols = ds.fields.map((f) => f.name);
    setDatasetColumns(cols);

    if (!selectedColumn) {
      const imgCol = cols.find((c) => /img|image|photo|pic|src/i.test(c)) || cols[0];
      if (imgCol) setSelectedColumn(imgCol);
    }
  }, [selectedDatasetId, datasets, selectedColumn]);

  // Load images from selected dataset column
  useEffect(() => {
    if (sourceMode !== 'dataset' || !selectedDatasetId || !selectedColumn) return;

    let live = true;
    setIsScanning(true);
    void getDatasetRecords(selectedDatasetId)
      .then((records: ExtractedRecord[]) => {
        if (!live) return;
        const items: ImageItem[] = [];
        const seen = new Set<string>();

        for (let i = 0; i < records.length; i++) {
          const r = records[i];
          const raw = String(r[selectedColumn] ?? '').trim();
          if (!raw.startsWith('http://') && !raw.startsWith('https://')) continue;
          if (seen.has(raw)) continue;
          seen.add(raw);

          const altText = String(r['Title'] || r['Name'] || r['alt'] || `image_${i + 1}`);
          items.push({
            id: `img_ds_${i}`,
            url: raw,
            alt: altText,
            width: 0,
            height: 0,
            extension: extractImageExtension(raw),
            pageUrl: raw,
            recordData: r as Record<string, unknown>,
          });
        }

        setImages(items);
        setSelectedIds(new Set(items.map((it) => it.id)));
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (live) setIsScanning(false);
      });

    return () => {
      live = false;
    };
  }, [sourceMode, selectedDatasetId, selectedColumn, getDatasetRecords]);

  // Scan current page
  const handleScanPage = async () => {
    if (!tab.id || !tab.isInjectable) {
      setError('Active tab is not readable.');
      return;
    }

    setError(null);
    setIsScanning(true);
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: executePageImageScan,
        args: [autoScroll],
      });

      const scanned = (res?.result || []) as Array<{
        url: string;
        alt: string;
        width: number;
        height: number;
        pageUrl: string;
      }>;

      const items: ImageItem[] = scanned.map((item, idx) => ({
        id: `img_scan_${idx}`,
        url: item.url,
        alt: item.alt || `image_${idx + 1}`,
        width: item.width,
        height: item.height,
        extension: extractImageExtension(item.url),
        pageUrl: item.pageUrl,
      }));

      setImages(items);
      setSelectedIds(new Set(items.map((it) => it.id)));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsScanning(false);
    }
  };

  // Filtered images list
  const filteredImages = useMemo(() => {
    return images.filter((img) => {
      // Dimension filter (only if scanned dimensions are present > 0)
      if (minDimensionFilter && img.width > 0 && img.height > 0) {
        if (img.width < 100 || img.height < 100) return false;
      }
      // Format filter
      if (selectedFormat !== 'All') {
        const ext = img.extension.toLowerCase();
        if (selectedFormat === 'JPG' && ext !== 'jpg' && ext !== 'jpeg') return false;
        if (selectedFormat === 'PNG' && ext !== 'png') return false;
        if (selectedFormat === 'WEBP' && ext !== 'webp') return false;
        if (selectedFormat === 'SVG' && ext !== 'svg') return false;
        if (selectedFormat === 'GIF' && ext !== 'gif') return false;
      }
      return true;
    });
  }, [images, minDimensionFilter, selectedFormat]);

  const selectedCount = useMemo(() => {
    return filteredImages.filter((img) => selectedIds.has(img.id)).length;
  }, [filteredImages, selectedIds]);

  const toggleSelectAll = () => {
    if (selectedCount === filteredImages.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredImages.map((img) => img.id)));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Template preview for first 3 images
  const templatePreviews = useMemo(() => {
    const selected = filteredImages.filter((img) => selectedIds.has(img.id)).slice(0, 3);
    return selected.map((img, idx) => {
      let domain = 'website';
      try {
        domain = new URL(img.pageUrl || img.url).hostname;
      } catch {
        // Ignore
      }
      return interpolateFilenameTemplate(template, {
        index: idx,
        domain,
        alt: img.alt,
        ext: img.extension,
        record: img.recordData,
      });
    });
  }, [filteredImages, selectedIds, template]);

  // Start download queue
  const handleStartDownload = async () => {
    const chosen = filteredImages.filter((img) => selectedIds.has(img.id));
    if (chosen.length === 0 || isDownloading) return;

    setError(null);
    setIsDownloading(true);
    setIsPaused(false);

    const targets = chosen.map((img, idx) => {
      let domain = 'website';
      try {
        domain = new URL(img.pageUrl || img.url).hostname;
      } catch {
        // Ignore
      }
      const filename = interpolateFilenameTemplate(template, {
        index: idx,
        domain,
        alt: img.alt,
        ext: img.extension,
        record: img.recordData,
      });
      return { url: img.url, filename };
    });

    const runner = new ImageDownloaderRunner({
      targets,
      minDelayMs: 300,
      onProgress: (p) => setDownloadProgress(p),
    });

    runnerRef.current = runner;
    try {
      await runner.start();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDownloading(false);
      setIsPaused(false);
      runnerRef.current = null;
    }
  };

  const handlePauseResume = () => {
    if (!runnerRef.current) return;
    if (isPaused) {
      runnerRef.current.resume();
      setIsPaused(false);
    } else {
      runnerRef.current.pause();
      setIsPaused(true);
    }
  };

  const handleStop = () => {
    runnerRef.current?.cancel();
    setIsDownloading(false);
    setIsPaused(false);
  };

  // Save scanned images as a Dexie dataset
  const handleSaveAsDataset = async () => {
    const chosen = filteredImages.filter((img) => selectedIds.has(img.id));
    if (chosen.length === 0) return;

    try {
      let host = 'images';
      try {
        if (chosen[0]?.pageUrl) host = new URL(chosen[0].pageUrl).hostname;
      } catch {
        // Ignore
      }

      const name = `Images - ${host} (${chosen.length} items)`;
      const fields: FieldDefinition[] = [
        { id: 'f_url', name: 'Image URL', selector: 'Image URL', extractor: 'src', transform: 'trim', required: true },
        { id: 'f_alt', name: 'Alt Text', selector: 'Alt Text', extractor: 'text', transform: 'trim', required: false },
        { id: 'f_ext', name: 'Extension', selector: 'Extension', extractor: 'text', transform: 'trim', required: false },
        { id: 'f_width', name: 'Width', selector: 'Width', extractor: 'number', transform: 'trim', required: false },
        { id: 'f_height', name: 'Height', selector: 'Height', extractor: 'number', transform: 'trim', required: false },
        { id: 'f_page', name: 'Source Page', selector: 'Source Page', extractor: 'href', transform: 'trim', required: false },
      ];

      const records: ExtractedRecord[] = chosen.map((img, idx) => ({
        _id: `img_${Date.now()}_${idx}`,
        _page: 1,
        _extractedAt: Date.now(),
        'Image URL': img.url,
        'Alt Text': img.alt,
        Extension: img.extension,
        Width: img.width,
        Height: img.height,
        'Source Page': img.pageUrl,
      }));

      const dsId = await messagingService.createDataset(name, chosen[0]?.pageUrl || '', fields, records);
      setSavedDatasetId(dsId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
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
            <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-tool-violet/25 bg-tool-violet/15 text-tool-violet">
              <ImageIcon className="h-4 w-4" />
            </span>
            <h2 className="text-sm ph-heading text-fg">Bulk Image Downloader</h2>
          </div>
        </div>

        {savedDatasetId && (
          <Button
            variant="ghost"
            size="sm"
            iconRight={<ExternalLink className="h-3.5 w-3.5" />}
            onClick={() => {
              if (onOpenTable) onOpenTable(savedDatasetId);
              else void openWorkbench({ datasetId: savedDatasetId });
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

      {/* ① Section 1: Source Selector (Current Page vs Dataset) */}
      <Card className="flex flex-col gap-2.5 p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-fg">Image Source</span>
          <div className="flex rounded-lg border border-line bg-surface-sunken p-0.5 text-2xs">
            <button
              type="button"
              onClick={() => setSourceMode('page')}
              disabled={isDownloading}
              className={`rounded-md px-2 py-0.5 transition-colors ${
                sourceMode === 'page'
                  ? 'border border-tool-violet/45 bg-tool-violet/15 text-fg font-semibold'
                  : 'border border-transparent text-fg-muted hover:text-fg'
              }`}
            >
              Current Page
            </button>
            <button
              type="button"
              onClick={() => setSourceMode('dataset')}
              disabled={isDownloading}
              className={`rounded-md px-2 py-0.5 transition-colors ${
                sourceMode === 'dataset'
                  ? 'border border-tool-violet/45 bg-tool-violet/15 text-fg font-semibold'
                  : 'border border-transparent text-fg-muted hover:text-fg'
              }`}
            >
              From Dataset
            </button>
          </div>
        </div>

        {sourceMode === 'page' ? (
          <div className="flex items-center justify-between gap-2 pt-1">
            <label className="flex items-center gap-1.5 text-2xs text-fg cursor-pointer">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                disabled={isScanning || isDownloading}
                className="accent-tool-violet"
              />
              <span>Auto-scroll to trigger lazy images</span>
            </label>

            <Button
              variant="outline"
              size="sm"
              iconLeft={isScanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
              onClick={() => void handleScanPage()}
              disabled={isScanning || isDownloading || !tab.isInjectable}
            >
              {isScanning ? 'Scanning…' : 'Scan Page Images'}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <div className="flex flex-col gap-1">
              <span className="ph-eyebrow text-fg-subtle">Dataset</span>
              <select
                value={selectedDatasetId}
                onChange={(e) => setSelectedDatasetId(e.target.value)}
                disabled={isDownloading}
                className="rounded-xl border border-line bg-surface p-1.5 text-2xs text-fg"
              >
                <option value="">-- Choose Dataset --</option>
                {datasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.recordsCount})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="ph-eyebrow text-fg-subtle">Image URL Column</span>
              <select
                value={selectedColumn}
                onChange={(e) => setSelectedColumn(e.target.value)}
                disabled={isDownloading || datasetColumns.length === 0}
                className="rounded-xl border border-line bg-surface p-1.5 text-2xs text-fg"
              >
                <option value="">-- Pick Column --</option>
                {datasetColumns.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </Card>

      {/* ② Section 2: Filters & Filename Template */}
      {images.length > 0 && (
        <Card className="flex flex-col gap-2.5 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-fg">
              <Filter className="h-3.5 w-3.5 text-tool-violet" />
              <span>Filters & Naming</span>
            </div>
            <span className="text-2xs text-fg-subtle ph-tabular">
              Selected: <strong className="text-tool-violet">{selectedCount}</strong> / {filteredImages.length}
            </span>
          </div>

          {/* Format Chips & Dimension Filter */}
          <div className="flex flex-wrap items-center justify-between gap-1.5 pt-0.5">
            <div className="flex flex-wrap gap-1">
              {FORMAT_OPTIONS.map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => setSelectedFormat(fmt)}
                  className={`rounded-md px-1.5 py-0.5 text-2xs font-medium transition-colors ${
                    selectedFormat === fmt
                      ? 'bg-tool-violet/15 border border-tool-violet/45 text-tool-violet font-semibold'
                      : 'border border-line bg-surface text-fg-muted hover:border-line-strong'
                  }`}
                >
                  {fmt}
                </button>
              ))}
            </div>

            <label className="flex items-center gap-1.5 text-2xs text-fg cursor-pointer">
              <input
                type="checkbox"
                checked={minDimensionFilter}
                onChange={(e) => setMinDimensionFilter(e.target.checked)}
                className="accent-tool-violet"
              />
              <span>Hide &lt; 100px icons</span>
            </label>
          </div>

          {/* Select All Toggle */}
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={toggleSelectAll}
              className="flex items-center gap-1 text-2xs text-fg hover:text-tool-violet ph-tabular"
            >
              {selectedCount === filteredImages.length && filteredImages.length > 0 ? (
                <CheckSquare className="h-3.5 w-3.5 text-tool-violet" />
              ) : (
                <Square className="h-3.5 w-3.5 text-fg-muted" />
              )}
              <span>{selectedCount === filteredImages.length ? 'Deselect All' : 'Select All'}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowTemplateTokens(!showTemplateTokens)}
              className="flex items-center gap-1 text-2xs text-tool-violet hover:underline"
            >
              <span>Filename Template</span>
              {showTemplateTokens ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </button>
          </div>

          {/* Template Input */}
          <div className="flex flex-col gap-1.5 pt-0.5">
            <input
              type="text"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              disabled={isDownloading}
              placeholder="{domain}/{alt}-{index}.{ext}"
              className="w-full rounded-xl border border-line bg-surface-sunken p-1.5 text-2xs text-fg font-mono focus:outline-none focus:border-tool-violet"
            />

            {showTemplateTokens && (
              <div className="flex flex-wrap gap-1 p-1.5 bg-surface-muted rounded-lg text-2xs text-fg-subtle">
                <span className="self-center font-semibold">Tokens:</span>
                {['{index}', '{domain}', '{alt}', '{ext}', ...(datasetColumns.map((c) => `{${c}}`))].map((token) => (
                  <button
                    key={token}
                    type="button"
                    onClick={() => setTemplate((prev) => `${prev.replace(/\.\{ext\}$/, '')}-${token}.{ext}`)}
                    className="rounded bg-surface px-1.5 py-0.5 font-mono text-fg border border-line hover:border-tool-violet"
                  >
                    {token}
                  </button>
                ))}
              </div>
            )}

            {/* Live Filename Previews */}
            {templatePreviews.length > 0 && (
              <div className="flex flex-col gap-0.5 rounded-lg bg-surface-sunken border border-line-subtle p-1.5 text-2xs font-mono text-fg-muted">
                <span className="ph-eyebrow text-tool-violet">Preview:</span>
                {templatePreviews.map((p, idx) => (
                  <span key={idx} className="truncate">
                    {p}
                  </span>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ③ Section 3: Thumbnail Grid & Execution */}
      {filteredImages.length > 0 && (
        <Card className="flex flex-col gap-2.5 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-fg">
              <Layers className="h-3.5 w-3.5 text-tool-violet" />
              <span>Image Gallery ({filteredImages.length})</span>
            </div>

            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleSaveAsDataset()}
                disabled={selectedCount === 0 || isDownloading}
              >
                Save as Dataset
              </Button>

              {!isDownloading ? (
                <Button
                  variant="primary"
                  size="sm"
                  iconLeft={<Download className="h-3.5 w-3.5" />}
                  onClick={() => void handleStartDownload()}
                  disabled={selectedCount === 0}
                >
                  Download {selectedCount}
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

          {/* Download Progress */}
          {downloadProgress && (
            <div className="flex flex-col gap-1.5 pt-1">
              <div className="flex items-center justify-between text-2xs text-fg-subtle ph-tabular">
                <span>
                  Downloaded {downloadProgress.completed} of {downloadProgress.total}
                </span>
                <span>{Math.round((downloadProgress.completed / (downloadProgress.total || 1)) * 100)}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
                <div
                  className="h-full bg-tool-violet transition-all duration-300"
                  style={{
                    width: `${Math.min(100, Math.round((downloadProgress.completed / (downloadProgress.total || 1)) * 100))}%`,
                  }}
                />
              </div>
              {isDownloading && (
                <p className="text-2xs text-fg-muted italic">
                  Keep this panel or workbench tab open while running
                </p>
              )}
            </div>
          )}

          {/* Thumbnail Grid */}
          <div className="grid grid-cols-3 gap-2 max-h-72 overflow-y-auto p-1.5 border border-line/70 rounded-xl bg-surface-sunken">
            {filteredImages.map((img) => {
              const isSelected = selectedIds.has(img.id);
              return (
                <div
                  key={img.id}
                  onClick={() => toggleSelect(img.id)}
                  className={`group relative flex flex-col overflow-hidden rounded-lg border bg-surface transition-all cursor-pointer ${
                    isSelected
                      ? 'border-tool-violet ring-1 ring-tool-violet'
                      : 'border-line hover:border-line-strong'
                  }`}
                >
                  <div className="relative aspect-square w-full bg-surface-muted flex items-center justify-center overflow-hidden">
                    <img
                      src={img.url}
                      alt={img.alt}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                    <div className="absolute top-1 left-1 rounded bg-surface/90 border border-line/70 p-0.5 text-fg">
                      {isSelected ? (
                        <CheckSquare className="h-3.5 w-3.5 text-tool-violet" />
                      ) : (
                        <Square className="h-3.5 w-3.5 text-fg-subtle" />
                      )}
                    </div>
                    {img.width > 0 && img.height > 0 && (
                      <span className="absolute bottom-1 right-1 rounded bg-surface/90 border border-line/70 px-1 py-0.5 text-2xs font-mono ph-tabular text-fg">
                        {img.width}×{img.height}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between px-1.5 py-1 text-2xs">
                    <span className="uppercase font-semibold text-tool-violet">{img.extension}</span>
                    <a
                      href={img.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-fg-subtle hover:text-fg"
                      title="Open full image"
                    >
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
};

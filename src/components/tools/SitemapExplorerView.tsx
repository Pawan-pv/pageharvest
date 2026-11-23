import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckSquare,
  ExternalLink,
  FolderTree,
  Loader2,
  Map as MapIcon,
  Search,
  Square,
  StopCircle,
} from 'lucide-react';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { Input } from '@/components/common/Input';
import { Banner } from '@/components/common/Banner';
import { runSitemapScan } from '@/background/runners/sitemap-runner';
import type { SitemapEntry, SitemapProgress } from '@/core/sitemap/types';
import { messagingService } from '@/services/messaging';
import { storeUrlHandoff } from '@/platform/url-handoff';
import { openWorkbench } from '@/platform/workbench';
import type { FieldDefinition, RecordEntity } from '@/types';

export interface SitemapExplorerViewProps {
  initialUrl?: string;
  onBack?: () => void;
  onSendUrlsToTool?: (urls: string[]) => void;
}

interface PathGroup {
  prefix: string;
  count: number;
}

export const SitemapExplorerView: React.FC<SitemapExplorerViewProps> = ({
  initialUrl = '',
  onBack,
  onSendUrlsToTool,
}) => {
  const [siteUrl, setSiteUrl] = useState(() => {
    try {
      if (initialUrl && initialUrl.startsWith('http')) {
        return new URL(initialUrl).origin;
      }
    } catch {
      // Ignore
    }
    return initialUrl;
  });

  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState<SitemapProgress | null>(null);
  const [entries, setEntries] = useState<SitemapEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savedDatasetId, setSavedDatasetId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Filters
  const [selectedPrefixes, setSelectedPrefixes] = useState<Set<string>>(new Set());
  const [searchFilter, setSearchFilter] = useState('');

  const abortControllerRef = useRef<AbortController | null>(null);

  const startScan = async () => {
    const trimmed = siteUrl.trim();
    if (!trimmed) return;

    setError(null);
    setEntries([]);
    setSelectedPrefixes(new Set());
    setSavedDatasetId(null);
    setIsScanning(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const result = await runSitemapScan({
        startUrl: trimmed,
        signal: controller.signal,
        onProgress: (p) => setProgress(p),
      });

      setEntries(result.urls);
      if (result.urls.length === 0) {
        setError('No URLs found in the sitemaps. Check the URL or robots.txt.');
      } else {
        // Select all prefixes by default
        const prefixes = new Set<string>();
        for (const entry of result.urls) {
          try {
            const p = new URL(entry.loc).pathname;
            const segments = p.split('/').filter(Boolean);
            const prefix = segments.length > 0 ? `/${segments[0]}` : '/';
            prefixes.add(prefix);
          } catch {
            prefixes.add('/');
          }
        }
        setSelectedPrefixes(prefixes);
      }
    } catch (err: unknown) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setIsScanning(false);
      abortControllerRef.current = null;
    }
  };

  const stopScan = () => {
    abortControllerRef.current?.abort();
    setIsScanning(false);
  };

  // Group entries by path prefix
  const { pathGroups, prefixMap } = useMemo(() => {
    const counts = new Map<string, number>();
    const mapping = new Map<string, string>(); // entry.loc -> prefix

    for (const entry of entries) {
      let prefix: string;
      try {
        const p = new URL(entry.loc).pathname;
        const segments = p.split('/').filter(Boolean);
        prefix = segments.length > 0 ? `/${segments[0]}` : '/';
      } catch {
        prefix = '/';
      }
      mapping.set(entry.loc, prefix);
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    }

    const groups: PathGroup[] = Array.from(counts.entries())
      .map(([prefix, count]) => ({ prefix, count }))
      .sort((a, b) => b.count - a.count);

    return { pathGroups: groups, prefixMap: mapping };
  }, [entries]);

  // Filtered entries
  const filteredEntries = useMemo(() => {
    const q = searchFilter.trim().toLowerCase();
    return entries.filter((entry) => {
      const prefix = prefixMap.get(entry.loc) ?? '/';
      if (selectedPrefixes.size > 0 && !selectedPrefixes.has(prefix)) {
        return false;
      }
      if (q && !entry.loc.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [entries, selectedPrefixes, prefixMap, searchFilter]);

  const togglePrefix = (prefix: string) => {
    setSelectedPrefixes((prev) => {
      const next = new Set(prev);
      if (next.has(prefix)) next.delete(prefix);
      else next.add(prefix);
      return next;
    });
  };

  const toggleAllPrefixes = () => {
    if (selectedPrefixes.size === pathGroups.length) {
      setSelectedPrefixes(new Set());
    } else {
      setSelectedPrefixes(new Set(pathGroups.map((g) => g.prefix)));
    }
  };

  const saveAsDataset = async () => {
    if (filteredEntries.length === 0) return;
    setIsSaving(true);
    setError(null);

    try {
      const hostname = new URL(filteredEntries[0].loc).hostname;
      const name = `Sitemap - ${hostname} (${filteredEntries.length} URLs)`;

      const fields: FieldDefinition[] = [
        { id: 'f_url', name: 'URL', selector: 'loc', extractor: 'text', transform: 'trim', required: true },
        { id: 'f_path', name: 'Path', selector: 'path', extractor: 'text', transform: 'trim', required: false },
        { id: 'f_lastmod', name: 'Last Modified', selector: 'lastmod', extractor: 'text', transform: 'trim', required: false },
        { id: 'f_changefreq', name: 'Change Frequency', selector: 'changefreq', extractor: 'text', transform: 'trim', required: false },
        { id: 'f_priority', name: 'Priority', selector: 'priority', extractor: 'text', transform: 'trim', required: false },
      ];

      const records: RecordEntity[] = filteredEntries.map((e, idx) => {
        let pathname = '/';
        try {
          pathname = new URL(e.loc).pathname;
        } catch {
          // Ignore
        }
        return {
          _id: `sitemap_${idx}_${Date.now()}`,
          _page: 1,
          _extractedAt: Date.now(),
          URL: e.loc,
          Path: pathname,
          'Last Modified': e.lastmod ?? '',
          'Change Frequency': e.changefreq ?? '',
          Priority: e.priority ?? '',
        };
      });

      const id = await messagingService.createDataset(name, siteUrl, fields, records);
      setSavedDatasetId(id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendToTool = async () => {
    const urls = filteredEntries.map((e) => e.loc);
    if (urls.length === 0) return;

    await storeUrlHandoff({
      tool: 'page',
      urls,
      source: 'sitemap',
      createdAt: Date.now(),
    });

    if (onSendUrlsToTool) {
      onSendUrlsToTool(urls);
    } else {
      void openWorkbench({ tool: 'page' });
    }
  };

  return (
    <div className="flex flex-col gap-3 p-4 text-left font-sans">
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
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-tool-indigo/25 bg-tool-indigo/15 text-tool-indigo"
          >
            <MapIcon className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-bold tracking-tight text-fg">Sitemap Explorer</h2>
            <p className="text-2xs text-fg-subtle">Discover, parse, and filter site XML sitemaps</p>
          </div>
        </div>
      </div>

      {error && (
        <Banner tone="danger" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}

      {savedDatasetId && (
        <Banner tone="success">
          <div className="flex items-center justify-between gap-2">
            <span>Saved {filteredEntries.length} URLs to your datasets.</span>
            <Button
              size="xs"
              variant="outline"
              iconRight={<ExternalLink className="h-3 w-3" />}
              onClick={() => void openWorkbench({ datasetId: savedDatasetId })}
            >
              Open Full Table ↗
            </Button>
          </div>
        </Banner>
      )}

      {/* URL Input Bar */}
      <Card className="flex flex-col gap-2 p-3">
        <label htmlFor="sitemap-url-input" className="text-2xs font-bold uppercase tracking-wider text-fg-muted">
          Website or Sitemap URL
        </label>
        <div className="flex items-center gap-2">
          <Input
            id="sitemap-url-input"
            value={siteUrl}
            onChange={(e) => setSiteUrl(e.target.value)}
            placeholder="https://example.com or https://example.com/sitemap.xml"
            disabled={isScanning}
          />
          {isScanning ? (
            <Button
              variant="danger"
              size="sm"
              iconLeft={<StopCircle className="h-4 w-4" />}
              onClick={stopScan}
            >
              Stop
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              iconLeft={<Search className="h-4 w-4" />}
              onClick={() => void startScan()}
              disabled={!siteUrl.trim()}
            >
              Explore
            </Button>
          )}
        </div>

        {isScanning && (
          <div className="flex items-center gap-2 pt-1 text-2xs text-tool-indigo">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>
              Scanned {progress?.sitemapsScanned ?? 0} sitemap(s), found {progress?.urlsFound ?? 0} URL(s)…
            </span>
          </div>
        )}
      </Card>

      {/* Discovered URLs & Filter Tree */}
      {entries.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {/* Summary and Primary Actions Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface p-2.5">
            <div className="text-xs">
              <span className="font-semibold text-fg">{filteredEntries.length}</span>
              <span className="text-fg-muted"> of {entries.length} URLs selected</span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="xs"
                onClick={() => void saveAsDataset()}
                isLoading={isSaving}
                disabled={filteredEntries.length === 0}
              >
                Save as Dataset
              </Button>
              <Button
                variant="primary"
                size="xs"
                onClick={() => void handleSendToTool()}
                disabled={filteredEntries.length === 0}
              >
                Send URLs to Tool →
              </Button>
            </div>
          </div>

          {/* Folder Path Tree Filter */}
          <Card className="flex flex-col gap-2 p-3">
            <div className="flex items-center justify-between gap-2 border-b border-line/60 pb-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-fg">
                <FolderTree className="h-3.5 w-3.5 text-tool-indigo" />
                <span>Folder Paths ({pathGroups.length})</span>
              </div>
              <button
                type="button"
                onClick={toggleAllPrefixes}
                className="text-2xs font-semibold text-brand-fg hover:underline"
              >
                {selectedPrefixes.size === pathGroups.length ? 'Deselect all' : 'Select all'}
              </button>
            </div>

            <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto pt-1">
              {pathGroups.map((group) => {
                const isSelected = selectedPrefixes.has(group.prefix);
                return (
                  <button
                    key={group.prefix}
                    type="button"
                    onClick={() => togglePrefix(group.prefix)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-2xs font-medium transition-colors ${
                      isSelected
                        ? 'border-tool-indigo/40 bg-tool-indigo/15 text-tool-indigo'
                        : 'border-line/70 bg-surface-muted text-fg-subtle hover:text-fg'
                    }`}
                  >
                    {isSelected ? <CheckSquare className="h-3 w-3" /> : <Square className="h-3 w-3" />}
                    <span>{group.prefix}</span>
                    <span className="text-3xs opacity-70">({group.count})</span>
                  </button>
                );
              })}
            </div>

            <div className="pt-2">
              <Input
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Filter URLs by keyword..."
                iconLeft={<Search className="h-3 w-3" />}
              />
            </div>
          </Card>

          {/* URL Preview List */}
          <Card className="flex flex-col gap-1 p-2">
            <div className="flex items-center justify-between px-1 py-0.5 text-3xs uppercase tracking-wider text-fg-subtle">
              <span>Preview (first 10 URLs)</span>
              <span>Total: {filteredEntries.length}</span>
            </div>
            <ul className="flex max-h-48 flex-col divide-y divide-line/40 overflow-y-auto">
              {filteredEntries.slice(0, 10).map((entry, idx) => (
                <li key={idx} className="flex flex-col py-1.5 px-1 text-2xs">
                  <span className="truncate font-mono text-fg" title={entry.loc}>
                    {entry.loc}
                  </span>
                  {(entry.lastmod || entry.priority) && (
                    <span className="text-3xs text-fg-subtle">
                      {entry.lastmod ? `Modified: ${entry.lastmod} ` : ''}
                      {entry.priority ? `· Priority: ${entry.priority}` : ''}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
};

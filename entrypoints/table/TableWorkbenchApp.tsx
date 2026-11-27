import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, Copy, ExternalLink, Link2, Loader2, Pause, Play, Trash2, XCircle } from 'lucide-react';
import { Banner } from '@/components/common/Banner';
import { BrandMark } from '@/components/common/BrandMark';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { EmptyState } from '@/components/common/EmptyState';
import { DataTable, type DataTableProps } from '@/components/grid/DataTable';
import { TOOL_OPTIONS, isToolType, toolLabel } from '@/components/grid/tool-catalog';
import { TabWorkerPool, createFetchRunner } from '@/background/tab-worker-pool';
import { useDatasets } from '@/hooks/useDatasets';
import { clearUrlHandoff, readUrlHandoff } from '@/platform/url-handoff';
import { messagingService } from '@/services/messaging';
import { isActiveJobStatus } from '@/shared/contracts/job';
import type { ToolJobProgress, ToolType, UrlHandoff } from '@/shared/contracts/tool-job';
import { JobRepository } from '@/storage/repositories';
import type { Dataset, ExtractedRecord, FieldDefinition } from '@/types';

const SitemapExplorerView = React.lazy(() =>
  import('@/components/tools/SitemapExplorerView').then((m) => ({ default: m.SitemapExplorerView }))
);
const PageExtractorView = React.lazy(() =>
  import('@/components/tools/PageExtractorView').then((m) => ({ default: m.PageExtractorView }))
);
const ShopifyExtractorView = React.lazy(() =>
  import('@/components/tools/ShopifyExtractorView').then((m) => ({ default: m.ShopifyExtractorView }))
);
const EmailExtractorView = React.lazy(() =>
  import('@/components/tools/EmailExtractorView').then((m) => ({ default: m.EmailExtractorView }))
);
const SocialExtractorView = React.lazy(() =>
  import('@/components/tools/SocialExtractorView').then((m) => ({ default: m.SocialExtractorView }))
);
const PageTextExtractorView = React.lazy(() =>
  import('@/components/tools/PageTextExtractorView').then((m) => ({ default: m.PageTextExtractorView }))
);
const ImageDownloaderView = React.lazy(() =>
  import('@/components/tools/ImageDownloaderView').then((m) => ({ default: m.ImageDownloaderView }))
);

interface TableView {
  kind: 'table';
  datasetId?: string;
}

interface ToolView {
  kind: 'tool';
  tool: ToolType;
}

type WorkbenchView = TableView | ToolView;

function initialView(search: string): WorkbenchView {
  const params = new URLSearchParams(search);
  const tool = params.get('tool');
  if (isToolType(tool)) return { kind: 'tool', tool };
  return { kind: 'table', datasetId: params.get('datasetId') ?? undefined };
}

function replaceQuery(view: WorkbenchView): void {
  const params = new URLSearchParams();
  if (view.kind === 'tool') params.set('tool', view.tool);
  else if (view.datasetId) params.set('datasetId', view.datasetId);
  const query = params.toString();
  const next = `${window.location.pathname}${query ? `?${query}` : ''}`;
  window.history.replaceState(null, '', next);
}

/** The full-tab shell: the same rows as the panel, with room to work. */
export const TableWorkbenchApp: React.FC = () => {
  const [view, setView] = useState<WorkbenchView>(() => initialView(window.location.search));

  const open = useCallback((next: WorkbenchView) => {
    replaceQuery(next);
    setView(next);
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-fg">
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 border-b border-line bg-dock-solid/95 px-6 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-2.5">
          <BrandMark size="sm" />
          <div className="min-w-0">
            <h1 className="text-sm ph-heading text-fg leading-tight">PageHarvest workbench</h1>
            <p className="text-2xs text-fg-muted">
              {view.kind === 'tool' ? toolLabel(view.tool) : 'Your saved lists, in a full browser tab.'}
            </p>
          </div>
        </div>
        {view.kind === 'tool' && (
          <Button
            variant="ghost"
            size="sm"
            iconLeft={<ArrowLeft aria-hidden="true" className="w-3.5 h-3.5" />}
            onClick={() => open({ kind: 'table' })}
          >
            Back to tables
          </Button>
        )}
      </header>

      <main className="min-h-0 flex-1">
        {view.kind === 'tool' ? (
          view.tool === 'page' ? (
            <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-6">
              <React.Suspense fallback={<p className="text-sm text-fg-muted">Loading Page Extractor…</p>}>
                <PageExtractorView
                  onBack={() => open({ kind: 'table' })}
                  onOpenTable={(datasetId) => open({ kind: 'table', datasetId })}
                />
              </React.Suspense>
            </div>
          ) : view.tool === 'sitemap' ? (
            <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-6">
              <React.Suspense fallback={<p className="text-sm text-fg-muted">Loading Sitemap Explorer…</p>}>
                <SitemapExplorerView
                  initialUrl=""
                  onBack={() => open({ kind: 'table' })}
                  onSendUrlsToTool={() => open({ kind: 'tool', tool: 'page' })}
                />
              </React.Suspense>
            </div>
          ) : view.tool === 'shopify' ? (
            <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-6">
              <React.Suspense fallback={<p className="text-sm text-fg-muted">Loading Shopify Extractor…</p>}>
                <ShopifyExtractorView
                  initialUrl=""
                  onBack={() => open({ kind: 'table' })}
                  onOpenTable={(datasetId) => open({ kind: 'table', datasetId })}
                />
              </React.Suspense>
            </div>
          ) : view.tool === 'email' ? (
            <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-6">
              <React.Suspense fallback={<p className="text-sm text-fg-muted">Loading Email Extractor…</p>}>
                <EmailExtractorView
                  onBack={() => open({ kind: 'table' })}
                  onOpenTable={(datasetId) => open({ kind: 'table', datasetId })}
                />
              </React.Suspense>
            </div>
          ) : view.tool === 'social' ? (
            <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-6">
              <React.Suspense fallback={<p className="text-sm text-fg-muted">Loading Social Link Extractor…</p>}>
                <SocialExtractorView
                  onBack={() => open({ kind: 'table' })}
                  onOpenTable={(datasetId) => open({ kind: 'table', datasetId })}
                />
              </React.Suspense>
            </div>
          ) : view.tool === 'page_text' ? (
            <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-6">
              <React.Suspense fallback={<p className="text-sm text-fg-muted">Loading Page Text Extractor…</p>}>
                <PageTextExtractorView
                  onBack={() => open({ kind: 'table' })}
                  onOpenTable={(datasetId) => open({ kind: 'table', datasetId })}
                />
              </React.Suspense>
            </div>
          ) : view.tool === 'images' ? (
            <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-6">
              <React.Suspense fallback={<p className="text-sm text-fg-muted">Loading Image Downloader…</p>}>
                <ImageDownloaderView
                  onBack={() => open({ kind: 'table' })}
                  onOpenTable={(datasetId) => open({ kind: 'table', datasetId })}
                />
              </React.Suspense>
            </div>
          ) : (
            <ToolWorkspace
              key={view.tool}
              tool={view.tool}
              onOpenTable={(datasetId) => open({ kind: 'table', datasetId })}
            />
          )
        ) : (
          <DatasetWorkbench initialDatasetId={view.datasetId} onOpenTool={(tool) => open({ kind: 'tool', tool })} />
        )}
      </main>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Saved lists
// ---------------------------------------------------------------------------

const DatasetWorkbench: React.FC<{
  initialDatasetId?: string;
  onOpenTool?: (tool: ToolType) => void;
}> = ({ initialDatasetId, onOpenTool }) => {
  const { datasets, isLoading, error, refreshDatasets, deleteDataset, renameDataset, getDatasetRecords } =
    useDatasets();
  const jobRepository = useMemo(() => new JobRepository(), []);
  const [activeId, setActiveId] = useState<string | undefined>(initialDatasetId);
  const [records, setRecords] = useState<ExtractedRecord[]>([]);
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isActiveJob, setIsActiveJob] = useState(false);
  const [runSummary, setRunSummary] = useState<DataTableProps['runSummary']>(null);
  const requestToken = useRef(0);
  const lastLoadedActiveIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (initialDatasetId) {
      setActiveId(initialDatasetId);
    }
  }, [initialDatasetId]);

  useEffect(() => {
    if (datasets.length === 0) {
      setActiveId(undefined);
      return;
    }
    if (!activeId || !datasets.some((dataset) => dataset.id === activeId)) {
      setActiveId(datasets[0].id);
    }
  }, [datasets, activeId]);

  const active: Dataset | undefined = datasets.find((dataset) => dataset.id === activeId);

  useEffect(() => {
    if (!active) {
      lastLoadedActiveIdRef.current = undefined;
      setRecords([]);
      setFields([]);
      return;
    }
    const token = ++requestToken.current;
    const isDatasetSwitch = lastLoadedActiveIdRef.current !== active.id;
    lastLoadedActiveIdRef.current = active.id;
    if (isDatasetSwitch) {
      setRecordsLoading(true);
    }
    setLoadError(null);
    void getDatasetRecords(active.id)
      .then((rows) => {
        if (requestToken.current !== token) return;
        setRecords(rows);
        setFields(active.fields);
      })
      .catch((cause: unknown) => {
        if (requestToken.current !== token) return;
        setLoadError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (requestToken.current === token) setRecordsLoading(false);
      });
  }, [active, getDatasetRecords]);

  useEffect(() => {
    let live = true;
    const jobId = active?.jobId;
    if (!jobId) {
      setIsActiveJob(false);
      setRunSummary(null);
      return undefined;
    }
    void jobRepository
      .getJob(jobId)
      .then((job) => {
        if (live) {
          setIsActiveJob(Boolean(job && isActiveJobStatus(job.status)));
          setRunSummary(
            job
              ? {
                  recordsDetected: job.recordsDetected,
                  totalExtracted: job.totalExtracted,
                  recordsWithMissingFields: job.recordsWithMissingFields,
                  recordsFiltered: job.recordsFiltered,
                  recordsFailed: job.recordsFailed,
                  duplicatesSkipped: job.duplicatesSkipped,
                }
              : null
          );
        }
      })
      .catch(() => {
        if (live) {
          setIsActiveJob(false);
          setRunSummary(null);
        }
      });
    return () => {
      live = false;
    };
  }, [active?.id, active?.jobId, jobRepository]);

  const activeDatasetId = active?.id;
  const activeJobId = active?.jobId;

  useEffect(() => {
    let live = true;
    const unsubscribe = messagingService.subscribe((message) => {
      if (message.type !== 'JOB_UPDATED') return;
      const matchesActiveJob = Boolean(activeJobId && message.payload.jobId === activeJobId);
      const awaitingInitialDataset = Boolean(initialDatasetId && !activeDatasetId);
      if (!matchesActiveJob && !awaitingInitialDataset) return;

      if (matchesActiveJob) {
        setIsActiveJob(isActiveJobStatus(message.payload.status));
      }
      void refreshDatasets({ silent: true });
      if (activeDatasetId) {
        void getDatasetRecords(activeDatasetId)
          .then((rows) => {
            if (live) setRecords(rows);
          })
          .catch(() => undefined);
      }
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [activeDatasetId, activeJobId, getDatasetRecords, initialDatasetId, refreshDatasets]);

  useEffect(() => {
    if (!isActiveJob || !active?.id) return undefined;
    let live = true;
    const datasetId = active.id;
    const jobId = active.jobId;
    const timer = setInterval(() => {
      void refreshDatasets({ silent: true });
      void getDatasetRecords(datasetId)
        .then((rows) => {
          if (live) setRecords(rows);
        })
        .catch(() => undefined);
      if (jobId) {
        void jobRepository
          .getJob(jobId)
          .then((job) => {
            if (live && job && !isActiveJobStatus(job.status)) {
              setIsActiveJob(false);
            }
          })
          .catch(() => undefined);
      }
    }, 1500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [active?.id, active?.jobId, getDatasetRecords, isActiveJob, jobRepository, refreshDatasets]);

  const selectDataset = (dataset: Dataset) => {
    setActiveId(dataset.id);
    replaceQuery({ kind: 'table', datasetId: dataset.id });
  };

  const handleRename = async (name: string) => {
    if (!active) return;
    await renameDataset(active.id, name);
  };

  const handleDelete = async () => {
    if (!active) return;
    await deleteDataset(active.id);
    const remaining = datasets.filter((dataset) => dataset.id !== active.id);
    setActiveId(remaining[0]?.id);
    replaceQuery({ kind: 'table', datasetId: remaining[0]?.id });
  };

  const applyEdit = async (rows: ExtractedRecord[], nextFields?: FieldDefinition[]) => {
    if (!active) return;
    await messagingService.applyDatasetEdit(active.id, rows, nextFields ?? fields);
    setFields(nextFields ?? fields);
  };

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 px-6 py-5">
      {error && (
        <Banner tone="danger" title="Saved lists could not be read" details={error}>
          Nothing was changed.
        </Banner>
      )}
      {loadError && (
        <Banner tone="danger" title="This list could not be opened" details={loadError}>
          Your saved data is still on this computer.
        </Banner>
      )}

      {isLoading ? (
        <p className="flex items-center gap-2 text-sm text-fg-muted" role="status">
          <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> Loading your saved lists…
        </p>
      ) : datasets.length === 0 ? (
        <EmptyState
          icon={<Link2 aria-hidden="true" className="w-6 h-6" />}
          title="Nothing saved yet"
          description="Collect a list from the side panel first. It will appear here, with room to clean it, merge columns, view pictures and send its links to a tool."
          action={null}
        />
      ) : (
        <DataTable
          fullPage
          dataset={active ?? null}
          records={records}
          fields={fields}
          runSummary={runSummary}
          isLoading={recordsLoading}
          datasets={datasets}
          onSelectDataset={selectDataset}
          onRenameDataset={handleRename}
          onDeleteDataset={handleDelete}
          onRecordsChange={applyEdit}
          onUpdateCell={(recordId, field, value) =>
            active ? messagingService.updateRecordCell(recordId, field, value) : undefined
          }
          onDeleteRecord={(recordId) =>
            active ? messagingService.deleteRecords(active.id, [recordId]).then(() => undefined) : undefined
          }
          onDeleteRecordsBatch={(recordIds) => {
            if (active) void messagingService.deleteRecords(active.id, recordIds);
          }}
          onOpenTool={onOpenTool}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// A tool's URL list
// ---------------------------------------------------------------------------

type CheckResult = { ok: boolean; detail: string };

const ToolWorkspace: React.FC<{
  tool: ToolType;
  onOpenTable: (datasetId?: string) => void;
}> = ({ tool, onOpenTable }) => {
  const [handoff, setHandoff] = useState<UrlHandoff | null>(null);
  const [urls, setUrls] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [progress, setProgress] = useState<ToolJobProgress | null>(null);
  const [results, setResults] = useState<Record<string, CheckResult>>({});
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const poolRef = useRef<TabWorkerPool | null>(null);

  useEffect(() => {
    let live = true;
    setIsLoading(true);
    void readUrlHandoff(tool)
      .then((stored) => {
        if (!live) return;
        setHandoff(stored);
        setUrls(stored?.urls ?? []);
      })
      .catch((cause: unknown) => {
        if (!live) return;
        setProblem(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (live) setIsLoading(false);
      });
    return () => {
      live = false;
      poolRef.current?.cancel();
      poolRef.current = null;
    };
  }, [tool]);

  const toolInfo = TOOL_OPTIONS.find((option) => option.id === tool);
  const checkedCount = Object.keys(results).length;

  const copyAll = async () => {
    setProblem(null);
    try {
      await navigator.clipboard.writeText(urls.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (cause: unknown) {
      setProblem(`The addresses were not copied: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };

  const clearList = async () => {
    try {
      await clearUrlHandoff(tool);
      setUrls([]);
      setHandoff(null);
      setResults({});
      setProgress(null);
    } catch (cause: unknown) {
      setProblem(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const checkAddresses = () => {
    if (urls.length === 0 || running) return;
    setProblem(null);
    setResults({});
    setProgress(null);
    setRunning(true);
    setPaused(false);

    const runner = createFetchRunner({
      extract: (html, url) => [
        { _id: url, _page: 1, _extractedAt: Date.now(), URL: url, Characters: html.length },
      ],
    });

    const pool = new TabWorkerPool({
      urls,
      runUrl: runner,
      commit: async (url, rows) => {
        const characters = rows[0]?.Characters;
        setResults((current) => ({
          ...current,
          [url]: {
            ok: true,
            detail:
              typeof characters === 'number'
                ? `${characters.toLocaleString('en-US')} characters read`
                : 'Reached',
          },
        }));
      },
      concurrency: 2,
      onProgress: setProgress,
    });
    poolRef.current = pool;

    void pool.run().then(() => {
      const failures = pool.getFailures();
      if (failures.length > 0) {
        setResults((current) => {
          const next = { ...current };
          for (const failure of failures) next[failure.url] = { ok: false, detail: failure.error };
          return next;
        });
      }
      setRunning(false);
      setPaused(false);
      poolRef.current = null;
    });
  };

  const pause = () => {
    poolRef.current?.pause();
    setPaused(true);
  };

  const resume = () => {
    poolRef.current?.resume();
    setPaused(false);
  };

  const cancel = () => {
    poolRef.current?.cancel();
    setRunning(false);
    setPaused(false);
    poolRef.current = null;
  };

  const remove = (url: string) => {
    setUrls((current) => current.filter((item) => item !== url));
    setResults((current) => {
      const next = { ...current };
      delete next[url];
      return next;
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 p-6">
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-fg">{toolInfo?.label ?? tool}</h2>
            <p className="mt-0.5 text-body text-fg-muted">{toolInfo?.description}</p>
            {handoff && (
              <p className="mt-1 text-2xs text-fg-subtle">
                {handoff.column ? `From the “${handoff.column}” column. ` : ''}
                {handoff.source === 'dataset_column' ? 'Sent from a saved table. ' : ''}
                {urls.length.toLocaleString('en-US')} {urls.length === 1 ? 'address' : 'addresses'}.
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {handoff?.datasetId && (
              <Button
                variant="ghost"
                size="sm"
                iconLeft={<ExternalLink aria-hidden="true" className="w-3.5 h-3.5" />}
                onClick={() => onOpenTable(handoff.datasetId)}
              >
                Open the table
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              iconLeft={<Copy aria-hidden="true" className="w-3.5 h-3.5" />}
              disabled={urls.length === 0}
              onClick={() => void copyAll()}
            >
              {copied ? 'Copied' : 'Copy all addresses'}
            </Button>
          </div>
        </div>

        {problem && (
          <Banner tone="danger" title="That did not work" onDismiss={() => setProblem(null)}>
            {problem}
          </Banner>
        )}

        {isLoading ? (
          <p className="flex items-center gap-2 text-sm text-fg-muted" role="status">
            <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> Reading the handed-over list…
          </p>
        ) : urls.length === 0 ? (
          <EmptyState
            icon={<Link2 aria-hidden="true" className="w-6 h-6" />}
            title="No addresses yet"
            description="Open a saved table, choose Send URLs to Tool, and pick this tool. The addresses will wait here."
            action={null}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                iconLeft={<CheckCircle2 aria-hidden="true" className="w-3.5 h-3.5" />}
                disabled={running}
                onClick={checkAddresses}
              >
                Check the addresses
              </Button>
              {running && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    iconLeft={
                      paused ? (
                        <Play aria-hidden="true" className="w-3.5 h-3.5" />
                      ) : (
                        <Pause aria-hidden="true" className="w-3.5 h-3.5" />
                      )
                    }
                    onClick={paused ? resume : pause}
                  >
                    {paused ? 'Resume' : 'Pause'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={cancel}>
                    Cancel
                  </Button>
                </>
              )}
              <Button variant="ghost" size="sm" iconLeft={<Trash2 aria-hidden="true" className="w-3.5 h-3.5" />} onClick={() => void clearList()}>
                Clear the list
              </Button>
              {progress && (
                <span className="text-xs text-fg-muted ph-tabular" role="status">
                  {progress.processedUrls} of {progress.totalUrls} checked
                  {progress.failedUrls > 0 ? ` · ${progress.failedUrls} could not be read` : ''}
                </span>
              )}
            </div>

            <ul className="flex max-h-[55vh] flex-col divide-y divide-line-subtle overflow-y-auto rounded-lg border border-line bg-surface">
              {urls.map((url, index) => {
                const result = results[url];
                return (
                  <li key={`${url}-${index}`} className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-surface-sunken/50 transition-colors">
                    <span className="w-8 shrink-0 text-right text-2xs ph-tabular text-fg-faint">{index + 1}</span>
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 flex-1 truncate font-mono text-2xs text-brand-fg hover:underline"
                      title={url}
                    >
                      {url}
                    </a>
                    {result && (
                      <span
                        className={`flex shrink-0 items-center gap-1 text-2xs ${
                          result.ok ? 'text-fg-muted' : 'text-danger-fg'
                        }`}
                        title={result.detail}
                      >
                        {result.ok ? (
                          <CheckCircle2 aria-hidden="true" className="w-3 h-3" />
                        ) : (
                          <XCircle aria-hidden="true" className="w-3 h-3" />
                        )}
                        <span className="hidden sm:inline">{result.detail}</span>
                      </span>
                    )}
                    <button
                      type="button"
                      aria-label={`Remove ${url}`}
                      onClick={() => remove(url)}
                      disabled={running}
                      className="shrink-0 rounded p-1 text-fg-faint hover:text-danger-fg disabled:opacity-40"
                    >
                      <Trash2 aria-hidden="true" className="w-3.5 h-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>

            {checkedCount > 0 && !running && (
              <p className="text-2xs text-fg-subtle">
                Checked {checkedCount} of {urls.length}. Checking only reads each page; nothing is saved or uploaded.
              </p>
            )}
          </>
        )}
      </Card>
    </div>
  );
};

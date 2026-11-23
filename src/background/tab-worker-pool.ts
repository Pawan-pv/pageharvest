import {
  DEFAULT_TOOL_CONCURRENCY,
  MAX_TOOL_CONCURRENCY,
  MIN_TOOL_DELAY_MS,
  type ToolJobProgress,
  type ToolJobStatus,
} from '@/shared/contracts/tool-job';
import { DatasetRepository } from '@/storage/repositories';
import type { PageHarvestDB } from '@/storage/db';
import type { ExtractedRecord } from '@/types';

/** One URL's rows. A runner throws when the page could not be read. */
export type ToolUrlRunner = (url: string, signal: AbortSignal) => Promise<ExtractedRecord[]>;

/** Writes one URL's rows. The background single-writer layer supplies this. */
export type ToolBatchCommitter = (url: string, rows: ExtractedRecord[]) => Promise<void>;

export type ToolDelay = (ms: number, signal: AbortSignal) => Promise<void>;

export interface TabWorkerPoolOptions {
  urls: string[];
  runUrl: ToolUrlRunner;
  commit: ToolBatchCommitter;
  concurrency?: number;
  minDelayMs?: number;
  /** Injected in tests so the 1000 ms rule is checked without waiting. */
  delay?: ToolDelay;
  onProgress?: (progress: ToolJobProgress) => void;
}

export interface ToolUrlFailure {
  url: string;
  error: string;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function abortError(): Error {
  const error = new Error('The tool job was cancelled.');
  error.name = 'AbortError';
  return error;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** Rejects as soon as the signal aborts, even when the runner ignores the signal. */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

export const defaultToolDelay: ToolDelay = (ms, signal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

function clampConcurrency(value: number | undefined): number {
  const requested = Number.isFinite(value) ? Math.trunc(value as number) : DEFAULT_TOOL_CONCURRENCY;
  return Math.min(MAX_TOOL_CONCURRENCY, Math.max(1, requested));
}

/**
 * Runs one tool over many URLs with a bounded number of workers, a minimum wait between
 * URLs per worker, and clean pause / resume / cancel.
 *
 * Every URL's rows are handed to `commit` before that URL counts as processed, so a
 * reported success always follows a committed batch. Cancelling stops new URLs at once
 * and rejects waits; a runner that is already working sees its AbortSignal and closes
 * whatever it opened in its own `finally`.
 */
export class TabWorkerPool {
  private readonly urls: string[];
  private readonly runUrl: ToolUrlRunner;
  private readonly commit: ToolBatchCommitter;
  private readonly delay: ToolDelay;
  private readonly onProgress?: (progress: ToolJobProgress) => void;
  private readonly concurrency: number;
  private readonly minDelayMs: number;
  private readonly controller = new AbortController();

  private status: ToolJobStatus = 'queued';
  private nextIndex = 0;
  private processedUrls = 0;
  private rowsExtracted = 0;
  private failedUrls = 0;
  private readonly failures: ToolUrlFailure[] = [];
  private paused = false;
  private gate: Promise<void> = Promise.resolve();
  private openGate: (() => void) | null = null;
  private runPromise: Promise<ToolJobProgress> | null = null;

  constructor(options: TabWorkerPoolOptions) {
    this.urls = [...options.urls];
    this.runUrl = options.runUrl;
    this.commit = options.commit;
    this.delay = options.delay ?? defaultToolDelay;
    this.onProgress = options.onProgress;
    this.concurrency = clampConcurrency(options.concurrency);
    this.minDelayMs = Math.max(MIN_TOOL_DELAY_MS, Math.trunc(options.minDelayMs ?? MIN_TOOL_DELAY_MS));
  }

  public getProgress(): ToolJobProgress {
    return {
      processedUrls: this.processedUrls,
      totalUrls: this.urls.length,
      rowsExtracted: this.rowsExtracted,
      failedUrls: this.failedUrls,
      status: this.status,
    };
  }

  public getFailures(): ToolUrlFailure[] {
    return [...this.failures];
  }

  /** The wait each worker keeps between two URLs, never below the ADR-046 minimum. */
  public getMinimumDelayMs(): number {
    return this.minDelayMs;
  }

  public getConcurrency(): number {
    return this.concurrency;
  }

  public run(): Promise<ToolJobProgress> {
    if (this.runPromise) return this.runPromise;
    this.runPromise = this.runAll();
    return this.runPromise;
  }

  public pause(): void {
    if (this.status !== 'running' && this.status !== 'queued') return;
    this.paused = true;
    this.status = 'paused';
    this.gate = new Promise<void>((resolve) => {
      this.openGate = resolve;
    });
    this.emit();
  }

  public resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.status = 'running';
    this.openGate?.();
    this.openGate = null;
    this.gate = Promise.resolve();
    this.emit();
  }

  public cancel(): void {
    if (this.status === 'completed' || this.status === 'cancelled' || this.status === 'failed') return;
    this.status = 'cancelled';
    this.paused = false;
    this.openGate?.();
    this.openGate = null;
    this.gate = Promise.resolve();
    this.controller.abort();
    this.emit();
  }

  private emit(): void {
    this.onProgress?.(this.getProgress());
  }

  private async runAll(): Promise<ToolJobProgress> {
    if (this.cancelled) {
      this.emit();
      return this.getProgress();
    }
    if (this.urls.length === 0) {
      this.status = 'completed';
      this.emit();
      return this.getProgress();
    }

    this.status = this.paused ? 'paused' : 'running';
    this.emit();
    const signal = this.controller.signal;
    const workerCount = Math.min(this.concurrency, this.urls.length);
    await Promise.all(Array.from({ length: workerCount }, () => this.worker(signal)));

    if (!this.cancelled) {
      this.status = this.failedUrls > 0 && this.failedUrls === this.urls.length ? 'failed' : 'completed';
    }
    this.emit();
    return this.getProgress();
  }

  private async worker(signal: AbortSignal): Promise<void> {
    for (;;) {
      if (this.cancelled) return;
      if (this.paused) {
        await this.gate;
        if (this.cancelled) return;
      }

      const index = this.nextIndex++;
      if (index >= this.urls.length) return;
      const url = this.urls[index];
      if (url === undefined) return;

      let rows: ExtractedRecord[];
      try {
        rows = await raceAbort(this.runUrl(url, signal), signal);
        if (this.cancelled) return;
        if (rows.length > 0) {
          await raceAbort(this.commit(url, rows), signal);
        }
        if (this.cancelled) return;
        this.rowsExtracted += rows.length;
      } catch (error: unknown) {
        if (this.cancelled || isAbortError(error)) return;
        this.failedUrls += 1;
        this.failures.push({ url, error: messageOf(error) });
      } finally {
        if (!this.cancelled) {
          this.processedUrls += 1;
          this.emit();
        }
      }

      if (this.cancelled) return;
      if (this.nextIndex < this.urls.length) {
        try {
          await this.delay(this.minDelayMs, signal);
        } catch {
          return;
        }
      }
    }
  }

  private get cancelled(): boolean {
    return this.status === 'cancelled' || this.controller.signal.aborted;
  }
}

// ---------------------------------------------------------------------------
// Runners
// ---------------------------------------------------------------------------

export interface FetchRunnerOptions {
  /** Injected in tests; the page is read without a tab, which is the fast mode. */
  fetchImpl?: typeof fetch;
  extract: (html: string, url: string) => ExtractedRecord[] | Promise<ExtractedRecord[]>;
}

/** The fast mode: read the page with fetch() and let the tool parse its HTML. */
export function createFetchRunner(options: FetchRunnerOptions): ToolUrlRunner {
  return async (url, signal) => {
    const fetchImpl = options.fetchImpl ?? fetch;
    const response = await fetchImpl(url, { signal, credentials: 'include' });
    if (!response.ok) {
      throw new Error(`The page answered ${response.status}.`);
    }
    const html = await response.text();
    return await options.extract(html, url);
  };
}

export interface TabRenderSession {
  openTab(): Promise<number>;
  navigateTab(tabId: number, url: string): Promise<void>;
  waitForLoad(tabId: number, signal: AbortSignal): Promise<void>;
  extract(tabId: number, url: string, signal: AbortSignal): Promise<ExtractedRecord[]>;
  closeTab(tabId: number): Promise<void>;
}

/**
 * The rendered mode: a real background tab loads the page, the tool reads it, and the
 * tab is closed in `finally` on success, error, timeout or cancel. No tab outlives a URL.
 */
export function createTabRenderRunner(session: TabRenderSession): ToolUrlRunner {
  return async (url, signal) => {
    let tabId: number | undefined;
    try {
      if (signal.aborted) throw abortError();
      tabId = await session.openTab();
      if (signal.aborted) throw abortError();
      await session.navigateTab(tabId, url);
      await session.waitForLoad(tabId, signal);
      if (signal.aborted) throw abortError();
      return await session.extract(tabId, url, signal);
    } catch (error: unknown) {
      if (isAbortError(error) || signal.aborted) throw abortError();
      throw new Error(`Could not read ${url}: ${messageOf(error)}`, { cause: error });
    } finally {
      if (tabId !== undefined) {
        await session.closeTab(tabId).catch(() => undefined);
      }
    }
  };
}

export interface ChromeTabsApiSubset {
  create(createProperties: chrome.tabs.CreateProperties): Promise<chrome.tabs.Tab>;
  update(tabId: number, updateProperties: chrome.tabs.UpdateProperties): Promise<chrome.tabs.Tab | undefined>;
  get(tabId: number): Promise<chrome.tabs.Tab>;
  remove(tabId: number | number[]): Promise<void>;
}

export interface ChromeTabRenderOptions {
  extract: (tabId: number, url: string, signal: AbortSignal) => Promise<ExtractedRecord[]>;
  chromeApi?: Pick<typeof chrome, 'tabs'> | { tabs: ChromeTabsApiSubset };
  pollMs?: number;
  timeoutMs?: number;
}

/** A TabRenderSession backed by the real chrome.tabs API. */
export function createChromeTabRenderSession(options: ChromeTabRenderOptions): TabRenderSession {
  const api = options.chromeApi ?? chrome;
  const pollMs = options.pollMs ?? 150;
  const timeoutMs = options.timeoutMs ?? 30_000;

  return {
    openTab: async () => {
      const tab = await api.tabs.create({ url: 'about:blank', active: false });
      if (typeof tab.id !== 'number') throw new Error('Chrome did not return a tab ID.');
      return tab.id;
    },
    navigateTab: async (tabId, url) => {
      await api.tabs.update(tabId, { url });
    },
    waitForLoad: async (tabId, signal) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if (signal.aborted) throw abortError();
        try {
          const tab = await api.tabs.get(tabId);
          if (tab.status === 'complete') return;
        } catch {
          throw new Error('The tab closed before the page finished loading.');
        }
        if (Date.now() > deadline) throw new Error('The page did not finish loading in time.');
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
          }, pollMs);
          const onAbort = () => {
            clearTimeout(timer);
            reject(abortError());
          };
          signal.addEventListener('abort', onAbort, { once: true });
        });
      }
    },
    extract: options.extract,
    closeTab: async (tabId) => {
      try {
        await api.tabs.remove(tabId);
      } catch {
        // Already gone; closing is best effort.
      }
    },
  };
}

/** Writes one URL's rows through the background's transactional dataset writer. */
export function createDatasetBatchCommitter(
  db: PageHarvestDB,
  datasetId: string
): ToolBatchCommitter {
  const repository = new DatasetRepository(db);
  return async (_url, rows) => {
    if (rows.length === 0) return;
    await repository.addRecords(datasetId, rows);
  };
}

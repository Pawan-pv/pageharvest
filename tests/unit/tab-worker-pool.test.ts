import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  TabWorkerPool,
  createFetchRunner,
  createTabRenderRunner,
  createChromeTabRenderSession,
  createDatasetBatchCommitter,
  abortError,
  isAbortError,
} from '@/background/tab-worker-pool';
import type { ExtractedRecord, ToolJobProgress } from '@/shared/contracts/tool-job';
import { PageHarvestDB } from '@/storage/db';

function makePool(options: Partial<ConstructorParameters<typeof TabWorkerPool>[0]> = {}): TabWorkerPool {
  const runUrl = options.runUrl ?? (async (url: string) => [
    { _id: url, _page: 1, _extractedAt: 1, URL: url, Characters: 10 },
  ]);
  const commit = options.commit ?? (async () => undefined);
  return new TabWorkerPool({
    urls: options.urls ?? ['https://example.com/a', 'https://example.com/b'],
    runUrl,
    commit,
    concurrency: options.concurrency,
    minDelayMs: options.minDelayMs,
    delay: options.delay,
    onProgress: options.onProgress,
  });
}

describe('TabWorkerPool', () => {
  it('clamps concurrency to 1-5 and defaults to 2', () => {
    expect(makePool({ concurrency: 0 }).getConcurrency()).toBe(1);
    expect(makePool({ concurrency: 1 }).getConcurrency()).toBe(1);
    expect(makePool({}).getConcurrency()).toBe(2);
    expect(makePool({ concurrency: 3 }).getConcurrency()).toBe(3);
    expect(makePool({ concurrency: 99 }).getConcurrency()).toBe(5);
  });

  it('enforces the 1000 ms minimum delay regardless of input', () => {
    expect(makePool({ minDelayMs: 100 }).getMinimumDelayMs()).toBe(1000);
    expect(makePool({ minDelayMs: 1000 }).getMinimumDelayMs()).toBe(1000);
    expect(makePool({ minDelayMs: 5000 }).getMinimumDelayMs()).toBe(5000);
  });

  it('runs all URLs, commits each batch, and reports progress', async () => {
    const commits: string[] = [];
    const progress: ToolJobProgress[] = [];
    const pool = makePool({
      urls: ['https://example.com/a', 'https://example.com/b'],
      commit: async (url) => {
        commits.push(url);
      },
      onProgress: (p) => progress.push(p),
    });

    const result = await pool.run();

    expect(result).toEqual({
      processedUrls: 2,
      totalUrls: 2,
      rowsExtracted: 2,
      failedUrls: 0,
      status: 'completed',
    });
    expect(commits).toEqual(['https://example.com/a', 'https://example.com/b']);
    // Commit for a URL completes before that URL is counted as processed.
    expect(progress[0]?.processedUrls).toBeLessThanOrEqual(1);
    expect(progress[progress.length - 1].processedUrls).toBe(2);
    expect(pool.getFailures()).toEqual([]);
  });

  it('counts failures but still completes when some URLs fail', async () => {
    const pool = makePool({
      urls: ['https://example.com/a', 'https://example.com/b'],
      runUrl: async (url) => {
        if (url.endsWith('/b')) throw new Error('boom');
        return [{ _id: url, _page: 1, _extractedAt: 1, URL: url }];
      },
    });

    const result = await pool.run();

    expect(result.status).toBe('completed');
    expect(result.processedUrls).toBe(2);
    expect(result.failedUrls).toBe(1);
    expect(result.rowsExtracted).toBe(1);
    expect(pool.getFailures()).toEqual([{ url: 'https://example.com/b', error: 'boom' }]);
  });

  it('reports failed when every URL fails', async () => {
    const pool = makePool({
      runUrl: async () => {
        throw new Error('down');
      },
    });

    const result = await pool.run();

    expect(result.status).toBe('failed');
    expect(result.processedUrls).toBe(2);
    expect(result.failedUrls).toBe(2);
  });

  it('commits before progress marks a URL processed', async () => {
    const order: string[] = [];
    const pool = makePool({
      urls: ['https://example.com/a', 'https://example.com/b'],
      commit: async (url) => {
        order.push(`commit:${url}`);
      },
      onProgress: () => {
        order.push('progress');
      },
    });

    await pool.run();

    const commitIndices = order
      .map((e, i) => (e.startsWith('commit:') ? i : -1))
      .filter((i) => i >= 0);
    const progressIndices = order.map((e, i) => (e === 'progress' ? i : -1)).filter((i) => i >= 0);
    expect(commitIndices.length).toBe(2);
    expect(progressIndices.length).toBeGreaterThan(0);
    for (const ci of commitIndices) {
      const nextProgress = progressIndices.find((pi) => pi > ci);
      expect(nextProgress).toBeDefined();
    }
  });

  it('handles an empty URL list as completed', async () => {
    const pool = new TabWorkerPool({
      urls: [],
      runUrl: async () => [],
      commit: async () => undefined,
    });
    const result = await pool.run();
    expect(result.status).toBe('completed');
    expect(result.processedUrls).toBe(0);
  });

  describe('pause / resume / cancel', () => {
    it('pauses and resumes via the public API', () => {
      const pool = makePool({ urls: ['https://example.com/a', 'https://example.com/b'] });
      expect(pool.getProgress().status).toBe('queued');
      pool.pause();
      expect(pool.getProgress().status).toBe('paused');
      pool.resume();
      expect(pool.getProgress().status).toBe('running');
    });

    it('pauses and resumes a running pool whose workers are blocked', async () => {
      let releaseDelay: () => void = () => undefined;
      let releaseB: () => void = () => undefined;
      const pool = makePool({
        urls: ['https://example.com/a', 'https://example.com/b'],
        delay: () => new Promise<void>((resolve) => {
          releaseDelay = resolve;
        }),
        runUrl: async (url) => {
          if (url.endsWith('/b')) {
            await new Promise<void>((resolve) => {
              releaseB = resolve;
            });
            return [{ _id: url, _page: 1, _extractedAt: 1, URL: url }];
          }
          return [{ _id: url, _page: 1, _extractedAt: 1, URL: url }];
        },
      });

      const runPromise = pool.run();
      await Promise.resolve();
      expect(pool.getProgress().status).toBe('running');

      pool.pause();
      expect(pool.getProgress().status).toBe('paused');

      pool.resume();
      releaseDelay();
      releaseB();
      await runPromise;
      expect(pool.getProgress().status).toBe('completed');
    });

    it('cancels a running pool without treating it as a failure', async () => {
      let hold: () => void = () => undefined;
      const pool = makePool({
        urls: ['https://example.com/a'],
        delay: async () => undefined,
        runUrl: async () => new Promise<ExtractedRecord[]>((resolve) => {
          hold = () => resolve([]);
        }),
      });

      const runPromise = pool.run();
      await Promise.resolve();
      expect(pool.getProgress().status).toBe('running');

      pool.cancel();
      hold();
      await runPromise;
      expect(pool.getProgress().status).toBe('cancelled');
      expect(pool.getFailures()).toEqual([]);
    });

    it('cancels a running pool and stops processing further URLs', async () => {
      let holdB: () => void = () => undefined;
      let releaseDelay: () => void = () => undefined;
      const started: string[] = [];
      const pool = makePool({
        urls: ['https://example.com/a', 'https://example.com/b', 'https://example.com/c'],
        delay: () => new Promise<void>((resolve) => {
          releaseDelay = resolve;
        }),
        runUrl: async (url) => {
          started.push(url);
          if (url.endsWith('/b')) return new Promise<ExtractedRecord[]>((resolve) => {
            holdB = () => resolve([]);
          });
          return [{ _id: url, _page: 1, _extractedAt: 1, URL: url }];
        },
      });

      const runPromise = pool.run();
      await Promise.resolve();
      expect(pool.getProgress().status).toBe('running');

      // Worker 0 takes 'a' then blocks on the delay; worker 1 takes 'b' and blocks.
      // 'c' is never started before cancel.
      pool.cancel();
      releaseDelay();
      holdB();
      await runPromise;
      expect(pool.getProgress().status).toBe('cancelled');
      expect(started).toEqual(['https://example.com/a', 'https://example.com/b']);
      expect(started).not.toContain('https://example.com/c');
      expect(pool.getFailures()).toEqual([]);
    });
  });

  describe('abort errors', () => {
    it('creates and recognises abort errors', () => {
      const err = abortError();
      expect(err.name).toBe('AbortError');
      expect(isAbortError(err)).toBe(true);
      expect(isAbortError(new Error('ordinary'))).toBe(false);
      expect(isAbortError('string')).toBe(false);
    });
  });
});

describe('createFetchRunner', () => {
  it('fetches, extracts, and returns rows', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<html><body>Hello</body></html>',
    } as unknown as Response);
    const extract = vi.fn((html: string) => [{ _id: 'u', _page: 1, _extractedAt: 1, Body: html }]);
    const runner = createFetchRunner({ fetchImpl, extract });

    const rows = await runner('https://example.com', new AbortController().signal);

    expect(fetchImpl).toHaveBeenCalledWith('https://example.com', {
      signal: expect.any(AbortSignal),
      credentials: 'include',
    });
    expect(extract).toHaveBeenCalledWith('<html><body>Hello</body></html>', 'https://example.com');
    expect(rows).toEqual([{ _id: 'u', _page: 1, _extractedAt: 1, Body: '<html><body>Hello</body></html>' }]);
  });

  it('throws when the response is not ok', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404 } as unknown as Response);
    const runner = createFetchRunner({ fetchImpl, extract: async () => [] });

    await expect(runner('https://example.com', new AbortController().signal)).rejects.toThrow(/404/);
  });

  it('propagates fetch errors as failures', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    const runner = createFetchRunner({ fetchImpl, extract: async () => [] });

    await expect(runner('https://example.com', new AbortController().signal)).rejects.toThrow(
      'network down'
    );
  });
});

describe('createTabRenderRunner closes its tab in finally', () => {
  it('closes the tab on success', async () => {
    const closed: number[] = [];
    const extracted: ExtractedRecord[] = [{ _id: 'u', _page: 1, _extractedAt: 1, URL: 'u' }];
    const session = {
      openTab: async () => 1,
      navigateTab: async () => undefined,
      waitForLoad: async () => undefined,
      extract: async () => extracted,
      closeTab: async (tabId: number) => {
        closed.push(tabId);
      },
    };
    const runner = createTabRenderRunner(session);

    const rows = await runner('https://example.com', new AbortController().signal);

    expect(rows).toBe(extracted);
    expect(closed).toEqual([1]);
  });

  it('still closes the tab when extraction fails', async () => {
    const closed: number[] = [];
    const session = {
      openTab: async () => 1,
      navigateTab: async () => undefined,
      waitForLoad: async () => undefined,
      extract: async () => {
        throw new Error('element gone');
      },
      closeTab: async (tabId: number) => {
        closed.push(tabId);
      },
    };
    const runner = createTabRenderRunner(session);

    await expect(runner('https://example.com', new AbortController().signal)).rejects.toThrow(
      'Could not read https://example.com: element gone'
    );
    expect(closed).toEqual([1]);
  });

  it('closes the tab when cancelled mid-load', async () => {
    const closed: number[] = [];
    const controller = new AbortController();
    const session = {
      openTab: async () => 1,
      navigateTab: async () => undefined,
      waitForLoad: async () => {
        controller.abort();
      },
      extract: async () => [],
      closeTab: async (tabId: number) => {
        closed.push(tabId);
      },
    };
    const runner = createTabRenderRunner(session);

    await expect(runner('https://example.com', controller.signal)).rejects.toThrow();
    expect(closed).toEqual([1]);
  });
});

describe('createChromeTabRenderSession leaves no orphan tabs', () => {
  it('opens, loads, extracts, and closes a tab through chrome.tabs', async () => {
    const removed: number[] = [];
    const chromeApi = {
      tabs: {
        create: vi.fn().mockResolvedValue({ id: 5 }),
        update: vi.fn().mockResolvedValue({ id: 5, status: 'complete' }),
        get: vi.fn().mockResolvedValue({ id: 5, status: 'complete' }),
        remove: vi.fn().mockImplementation((tabId: number) => {
          removed.push(tabId);
          return Promise.resolve();
        }),
      },
    };
    const extract = vi.fn().mockResolvedValue([
      { _id: 'u', _page: 1, _extractedAt: 1, URL: 'u' },
    ]);
    const session = createChromeTabRenderSession({ extract, chromeApi, pollMs: 1, timeoutMs: 1000 });
    const signal = new AbortController().signal;

    const tabId = await session.openTab();
    await session.navigateTab(tabId, 'https://example.com');
    await session.waitForLoad(tabId, signal);
    const rows = await session.extract(tabId, 'https://example.com', signal);
    await session.closeTab(tabId);

    expect(tabId).toBe(5);
    expect(removed).toEqual([5]);
    expect(rows).toEqual([{ _id: 'u', _page: 1, _extractedAt: 1, URL: 'u' }]);
    // A tab opened for one URL is closed for that URL: no orphan left behind.
    expect(removed.length).toBe(1);
  });

  it('runner closes the tab even when extraction throws', async () => {
    const closed: number[] = [];
    const chromeApi = {
      tabs: {
        create: vi.fn().mockResolvedValue({ id: 5 }),
        update: vi.fn().mockResolvedValue({ id: 5 }),
        get: vi.fn().mockResolvedValue({ id: 5, status: 'complete' }),
        remove: vi.fn().mockImplementation((tabId: number) => {
          closed.push(tabId);
          return Promise.resolve();
        }),
      },
    };
    const session = createChromeTabRenderSession({
      extract: async () => {
        throw new Error('extraction failed');
      },
      chromeApi,
      pollMs: 1,
      timeoutMs: 1000,
    });
    const runner = createTabRenderRunner(session);
    const signal = new AbortController().signal;

    await expect(runner('https://example.com', signal)).rejects.toThrow('extraction failed');
    expect(closed).toEqual([5]);
  });
});

describe('createDatasetBatchCommitter', () => {
  let db: PageHarvestDB;

  beforeEach(async () => {
    db = new PageHarvestDB(`PoolCommitDB_${Math.random().toString(36).slice(2)}`);
    await db.datasets.put({
      id: 'ds_commit',
      name: 'Commit list',
      url: 'https://example.com/list',
      recordsCount: 0,
      fields: [{ id: 'name', name: 'Name', selector: '.name', extractor: 'text' }],
      createdAt: 1,
      updatedAt: 1,
    });
  });

  afterEach(async () => {
    await db.close();
    await db.delete();
  });

  it('writes one URL rows through the transactional dataset writer', async () => {
    const commit = createDatasetBatchCommitter(db, 'ds_commit');
    const rows = [
      { _id: 'r1', _page: 1, _extractedAt: 1, _order: 1, datasetId: 'ds_commit', Name: 'One' },
    ];

    await commit('https://example.com/a', rows);

    const stored = await db.records.where('datasetId').equals('ds_commit').toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0].Name).toBe('One');
    expect((await db.datasets.get('ds_commit'))?.recordsCount).toBe(1);
  });

  it('ignores empty row batches', async () => {
    const commit = createDatasetBatchCommitter(db, 'ds_commit');
    await commit('https://example.com/a', []);
    const stored = await db.records.where('datasetId').equals('ds_commit').toArray();
    expect(stored).toHaveLength(0);
  });
});

import {
  TabWorkerPool,
  createFetchRunner,
  createTabRenderRunner,
  createChromeTabRenderSession,
  createDatasetBatchCommitter,
  type ToolBatchCommitter,
  type ToolUrlRunner,
} from '@/background/tab-worker-pool';
import { buildPageRecord } from '@/core/page-extract/extractor';
import { executeDomExtraction } from '@/core/page-extract/dom-extractor';
import type { PageExtractorOptions } from '@/core/page-extract/types';
import type { ExtractedRecord } from '@/types';
import { db as defaultDb, type PageHarvestDB } from '@/storage/db';

export function createPageExtractorRunner(
  options: PageExtractorOptions,
  dbInstance: PageHarvestDB = defaultDb
): TabWorkerPool {
  const hasCustomFields = Boolean(options.customFields && options.customFields.length > 0);
  const hasActions = Boolean(
    options.pageActions &&
      (options.pageActions.waitMs ||
        options.pageActions.scrollToBottom ||
        options.pageActions.clickSelector)
  );

  const mode = options.mode ?? (hasCustomFields || hasActions ? 'browser_tab' : 'fast_fetch');

  let runner: ToolUrlRunner;

  if (mode === 'fast_fetch') {
    runner = createFetchRunner({
      extract: (html, url) => {
        const record = buildPageRecord(html, url, {
          extractMetadata: options.extractMetadata ?? true,
          extractJsonLd: options.extractJsonLd ?? true,
        });
        options.onRowExtracted?.(record);
        return [record];
      },
    });
  } else {
    const session = createChromeTabRenderSession({
      extract: async (tabId, url) => {
        const [injectionResult] = await chrome.scripting.executeScript({
          target: { tabId },
          func: executeDomExtraction,
          args: [
            {
              extractMetadata: options.extractMetadata ?? true,
              extractJsonLd: options.extractJsonLd ?? true,
              customFields: options.customFields ?? [],
              pageActions: options.pageActions,
            },
          ],
        });

        const raw = (injectionResult?.result || {}) as Record<string, string>;
        const record: ExtractedRecord = {
          _id: `page_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          _page: 1,
          _extractedAt: Date.now(),
          URL: url,
          ...raw,
        };

        options.onRowExtracted?.(record);
        return [record];
      },
    });

    runner = createTabRenderRunner(session);
  }

  let commit: ToolBatchCommitter;
  if (options.datasetId) {
    commit = createDatasetBatchCommitter(dbInstance, options.datasetId);
  } else {
    commit = async () => undefined;
  }

  return new TabWorkerPool({
    urls: options.urls,
    runUrl: runner,
    commit,
    concurrency: options.concurrency,
    minDelayMs: options.minDelayMs,
    onProgress: options.onProgress,
  });
}

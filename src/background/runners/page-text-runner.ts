import {
  TabWorkerPool,
  createDatasetBatchCommitter,
  type ToolBatchCommitter,
  type ToolUrlRunner,
} from '@/background/tab-worker-pool';
import {
  extractPageText,
  type MarkdownExtractorOptions,
  type PageTextExtractionResult,
} from '@/core/page-text/markdown-extractor';
import type { ToolJobProgress } from '@/shared/contracts/tool-job';
import type { ExtractedRecord } from '@/types';
import { db as defaultDb, type PageHarvestDB } from '@/storage/db';

export interface PageTextRunnerOptions extends MarkdownExtractorOptions {
  urls: string[];
  datasetId?: string;
  mode?: 'fast_fetch' | 'browser_tab';
  concurrency?: number;
  minDelayMs?: number;
  onProgress?: (progress: ToolJobProgress) => void;
  onTextExtracted?: (item: PageTextExtractionResult) => void;
  onRowExtracted?: (record: ExtractedRecord) => void;
  fetchFn?: typeof fetch;
}

function resultToRecord(item: PageTextExtractionResult): ExtractedRecord {
  return {
    _id: `text_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    _page: 1,
    _extractedAt: Date.now(),
    URL: item.url,
    Title: item.title,
    Excerpt: item.excerpt,
    Markdown: item.markdown,
    'Plain Text': item.plainText,
    'Word Count': item.wordCount,
    'Estimated Tokens': item.estimatedTokens,
    Author: item.author,
    'Site Name': item.siteName,
    'Published Time': item.publishedTime,
  };
}

export function createPageTextRunner(
  options: PageTextRunnerOptions,
  dbInstance: PageHarvestDB = defaultDb
): TabWorkerPool {
  const fetchImpl = options.fetchFn ?? fetch;

  const runner: ToolUrlRunner = async (url: string, signal: AbortSignal) => {
    if (signal.aborted) return [];

    let html: string;
    if (options.mode === 'browser_tab' && typeof chrome !== 'undefined' && chrome.tabs?.create) {
      const tab = await chrome.tabs.create({ url, active: false });
      if (typeof tab.id !== 'number') throw new Error('Tab creation failed');

      try {
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }, 15000);

          const listener = (updatedId: number, info: chrome.tabs.TabChangeInfo) => {
            if (updatedId === tab.id && info.status === 'complete') {
              clearTimeout(timeout);
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
        });

        const [res] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => document.documentElement.outerHTML,
        });
        html = (res?.result as string) || '';
      } finally {
        await chrome.tabs.remove(tab.id).catch(() => undefined);
      }
    } else {
      const response = await fetchImpl(url, {
        signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PageHarvest/2.0',
        },
      });

      if (!response.ok) return [];
      html = await response.text();
    }

    if (!html) return [];

    const result = extractPageText(html, url, {
      includeMetadata: options.includeMetadata,
      includeMarkdown: options.includeMarkdown,
      includePlainText: options.includePlainText,
    });

    options.onTextExtracted?.(result);
    const record = resultToRecord(result);
    options.onRowExtracted?.(record);

    return [record];
  };

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

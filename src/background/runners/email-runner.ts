import {
  TabWorkerPool,
  createDatasetBatchCommitter,
  type ToolBatchCommitter,
  type ToolUrlRunner,
} from '@/background/tab-worker-pool';
import { extractEmailsFromHtml, type ExtractedEmail } from '@/core/email/email-parser';
import { extractContactLinks } from '@/core/crawl/contact-links';
import type { ToolJobProgress } from '@/shared/contracts/tool-job';
import type { ExtractedRecord } from '@/types';
import { db as defaultDb, type PageHarvestDB } from '@/storage/db';

export interface EmailExtractorOptions {
  urls: string[];
  datasetId?: string;
  depth?: number; // 0 = start URLs only, 1 = follow contact/about links
  maxSubpagesPerSite?: number; // 0 to 10, default 4
  mode?: 'fast_fetch' | 'browser_tab';
  concurrency?: number;
  minDelayMs?: number;
  deduplicate?: boolean;
  onProgress?: (progress: ToolJobProgress) => void;
  onEmailExtracted?: (email: ExtractedEmail) => void;
  onRowExtracted?: (record: ExtractedRecord) => void;
  fetchFn?: typeof fetch;
}

function emailToRecord(item: ExtractedEmail): ExtractedRecord {
  return {
    _id: `email_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    _page: 1,
    _extractedAt: Date.now(),
    Email: item.email,
    Domain: item.emailDomain,
    'Found Via': item.foundVia,
    'Source Page': item.sourceUrl,
    'Website Origin': item.originUrl,
    'Page Title': item.pageTitle || '',
    Depth: item.depth,
  };
}

export function createEmailExtractorRunner(
  options: EmailExtractorOptions,
  dbInstance: PageHarvestDB = defaultDb
): TabWorkerPool {
  const depth = options.depth ?? 1;
  const maxSubpages = options.maxSubpagesPerSite ?? 4;
  const fetchImpl = options.fetchFn ?? fetch;
  const dedupe = options.deduplicate ?? true;
  const seenEmails = new Set<string>();

  const runner: ToolUrlRunner = async (startingUrl: string, signal: AbortSignal) => {
    const records: ExtractedRecord[] = [];
    const origin = new URL(startingUrl).origin;

    const processPage = async (pageUrl: string, currentDepth: number): Promise<string> => {
      if (signal.aborted) return '';
      const response = await fetchImpl(pageUrl, {
        signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PageHarvest/2.0',
        },
      });

      if (!response.ok) return '';
      const html = await response.text();

      // Extract title if present
      const titleMatch = /<title[^>]*>(.*?)<\/title>/is.exec(html);
      const pageTitle = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';

      const emails = extractEmailsFromHtml(html, pageUrl, origin, currentDepth, pageTitle);
      for (const item of emails) {
        if (dedupe) {
          const key = item.email.toLowerCase();
          if (seenEmails.has(key)) continue;
          seenEmails.add(key);
        }
        options.onEmailExtracted?.(item);
        const record = emailToRecord(item);
        options.onRowExtracted?.(record);
        records.push(record);
      }

      return html;
    };

    // 1. Process starting URL (depth 0)
    const initialHtml = await processPage(startingUrl, 0);

    // 2. If depth >= 1, discover and crawl contact/about subpages
    if (depth >= 1 && initialHtml && maxSubpages > 0 && !signal.aborted) {
      const subpages = extractContactLinks(initialHtml, startingUrl, { maxSubpages });
      for (const subpageUrl of subpages) {
        if (signal.aborted) break;
        // Paced delay between subpages
        await new Promise((resolve) => setTimeout(resolve, Math.max(500, options.minDelayMs ?? 1000)));
        await processPage(subpageUrl, 1);
      }
    }

    return records;
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

/**
 * Navigation runner: the production orchestrator of a job's page-by-page execution.
 *
 * It runs inside the content script, on one document at a time, and decides how the
 * job moves on: extract once, click through pages, scroll, or follow a URL template.
 * Everything that must survive leaving this document goes through `commitBatch` and
 * `commitCheckpoint`, which only return after the background has durably stored it.
 */

export * from './types';
export * from './detector';
export * from './stability';
export * from './url-paginator';
export * from './scroller';
export * from './engine';

import { ExtractionEngine } from '@/core/extraction/extractor';
import { ExtractionSchema } from '@/shared/contracts/schema';
import { BatchStats, JobNavigationState, JobResumeState } from '@/shared/contracts/message';
import { ExtractedRecord, FieldDefinition } from '@/types';
import { runMultiPageExtraction } from './engine';
import {
  findLoadMoreControl,
  findNextPageControl,
  isLoadMoreText,
} from './detector';
import {
  buildTemplateUrl,
  isSameOrigin,
  normalizeUrlForDeduplication,
  validateUrlTemplate,
} from './url-paginator';
import { NavigationStrategy } from './types';

// ---------------------------------------------------------------------------
// Job execution
// ---------------------------------------------------------------------------

export interface JobBatchPayload {
  page: number;
  records: ExtractedRecord[];
  stats: BatchStats;
  navigation: JobNavigationState;
}

export interface CommitOutcome {
  inserted: number;
  shouldStop: boolean;
}

export interface NavigationJobOptions {
  recipe: ExtractionSchema;
  resume: JobResumeState;
  root: Document;
  signal: AbortSignal;
  getCurrentUrl: () => string;
  waitWhilePaused: () => Promise<void>;
  commitBatch: (batch: JobBatchPayload) => Promise<CommitOutcome>;
  commitCheckpoint: (navigation: JobNavigationState) => Promise<void>;
  /** Starts leaving this document for the given URL. Nothing after it is guaranteed to run. */
  navigateTo: (url: string) => void | Promise<void>;
  /** Overrides engine timing, for tests. */
  engineOverrides?: { pageTimeoutMs?: number; navigationTimeoutMs?: number };
}

export type NavigationJobOutcome =
  | { kind: 'finished'; stopReason: string }
  | { kind: 'cancelled' }
  /** The document is being replaced; the background continues the job from the checkpoint. */
  | { kind: 'navigating' };

export class NavigationJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NavigationJobError';
  }
}

function sleepUnlessCancelled(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
}

function asFields(recipe: ExtractionSchema): FieldDefinition[] {
  return recipe.fields.map((field) => ({
    id: field.id,
    name: field.name,
    selector: field.selector,
    extractor: field.extractor,
    attributeName: field.attributeName,
    regexPattern: field.regexPattern,
    regexGroup: field.regexGroup,
    defaultValue: field.defaultValue,
    required: field.required,
    transform: field.transform,
  }));
}

function assertValidContainer(recipe: ExtractionSchema, root: Document): void {
  try {
    root.querySelector(recipe.containerSelector);
  } catch {
    throw new NavigationJobError(
      `The container selector "${recipe.containerSelector}" is not a valid CSS selector.`
    );
  }
}

async function runSinglePageJob(options: NavigationJobOptions): Promise<NavigationJobOutcome> {
  const { recipe, resume, root, signal, getCurrentUrl, waitWhilePaused, commitBatch } = options;
  await waitWhilePaused();
  if (signal.aborted) return { kind: 'cancelled' };

  const url = getCurrentUrl();
  const output = new ExtractionEngine().extract({
    root,
    repeatedItemSelector: recipe.containerSelector,
    fields: asFields(recipe),
    pageNumber: resume.page,
    baseUrl: url,
    // Every matched element on a single page is its own row.
    deduplication: { enabled: false },
  });

  await commitBatch({
    page: resume.page,
    records: output.records,
    stats: {
      detected: output.statistics.totalParsed,
      missingFields: output.statistics.missingFieldRecordsCount,
      filtered: output.statistics.filteredRecordsCount,
      failed: output.statistics.erroredRecordsCount,
      duplicates: 0,
    },
    navigation: {
      nextPage: resume.page + 1,
      scrollsCompleted: 0,
      awaitingNavigation: false,
      visitedUrls: resume.visitedUrls,
      url,
    },
  });

  return { kind: 'finished', stopReason: 'completed' };
}

/**
 * URL-template jobs handle one document per run: extract this page, commit it together
 * with the URL that must load next, wait out the configured delay, then navigate.
 */
async function runUrlTemplateJob(options: NavigationJobOptions): Promise<NavigationJobOutcome> {
  const { recipe, resume, root, signal, getCurrentUrl, waitWhilePaused, commitBatch, navigateTo } = options;
  const pagination = recipe.pagination;
  const sequence = {
    template: pagination.urlTemplate ?? '',
    startPage: pagination.startPage,
    pageIncrement: pagination.pageIncrement,
  };
  const validation = validateUrlTemplate(sequence, resume.startUrl);
  if (!validation.valid) {
    throw new NavigationJobError(validation.error ?? 'The URL template is not valid.');
  }

  await waitWhilePaused();
  if (signal.aborted) return { kind: 'cancelled' };

  const step = resume.page;
  const url = getCurrentUrl();
  const output = new ExtractionEngine().extract({
    root,
    repeatedItemSelector: recipe.containerSelector,
    fields: asFields(recipe),
    pageNumber: step,
    baseUrl: url,
    // Durable deduplication across documents happens when the batch is committed.
    deduplication: { enabled: false },
  });

  const visitedUrls = Array.from(new Set([...resume.visitedUrls, normalizeUrlForDeduplication(url)]));
  const isLastAllowedPage = step >= pagination.maxPages;
  const nextUrl = isLastAllowedPage ? undefined : buildTemplateUrl(sequence, step + 1);

  if (nextUrl && !isSameOrigin(nextUrl, resume.startUrl)) {
    throw new NavigationJobError(`Refusing to navigate to another website: ${nextUrl}`);
  }
  if (nextUrl && visitedUrls.includes(normalizeUrlForDeduplication(nextUrl))) {
    throw new NavigationJobError('URL pagination generated a repeated or invalid next URL.');
  }

  const hasRows = output.records.length > 0;
  const commit = await commitBatch({
    page: step,
    records: output.records,
    stats: {
      detected: output.statistics.totalParsed,
      missingFields: output.statistics.missingFieldRecordsCount,
      filtered: output.statistics.filteredRecordsCount,
      failed: output.statistics.erroredRecordsCount,
      duplicates: 0,
    },
    navigation: {
      nextPage: step + 1,
      scrollsCompleted: 0,
      awaitingNavigation: Boolean(nextUrl) && hasRows,
      expectedUrl: hasRows ? nextUrl : undefined,
      visitedUrls,
      url,
    },
  });

  if (commit.shouldStop) return { kind: 'finished', stopReason: 'stopped_by_coordinator' };
  if (!hasRows) return { kind: 'finished', stopReason: 'empty_page' };
  if (commit.inserted === 0) return { kind: 'finished', stopReason: 'no_new_records' };
  if (!nextUrl) return { kind: 'finished', stopReason: 'max_pages_reached' };

  await sleepUnlessCancelled(pagination.delayMs, signal);
  await waitWhilePaused();
  if (signal.aborted) return { kind: 'cancelled' };

  await navigateTo(nextUrl);
  return { kind: 'navigating' };
}

/** Picks the engine strategy for a "next button" job from what is actually on the page. */
function resolveClickStrategy(root: Document, selector?: string): NavigationStrategy {
  const next = findNextPageControl(root, selector);
  if (next && isLoadMoreText(next.text)) return 'load_more';
  if (!next && findLoadMoreControl(root, selector)) return 'load_more';
  return 'next_link';
}

async function runEngineJob(options: NavigationJobOptions): Promise<NavigationJobOutcome> {
  const { recipe, resume, root, signal, getCurrentUrl, waitWhilePaused, commitBatch, commitCheckpoint } = options;
  const pagination = recipe.pagination;
  const isScroll = pagination.type === 'infinite_scroll';
  const strategy: NavigationStrategy = isScroll
    ? 'infinite_scroll'
    : resolveClickStrategy(root, pagination.nextButtonSelector);

  let visitedUrls = [...resume.visitedUrls];
  let scrollsAtLastBatch = resume.scrollsCompleted;

  const result = await runMultiPageExtraction({
    strategy,
    containerSelector: recipe.containerSelector,
    fields: asFields(recipe),
    controlSelector: pagination.nextButtonSelector,
    maxPages: pagination.maxPages,
    maxScrolls: pagination.scrollCount,
    maxRecords: pagination.maxRecords,
    delayMs: pagination.delayMs,
    scrollDelayMs: pagination.scrollDelayMs,
    documentRoot: root,
    getCurrentUrl,
    signal,
    waitWhilePaused,
    allowedOrigin: new URL(resume.startUrl).origin,
    ...options.engineOverrides,
    initialSessionState: {
      strategy,
      currentPage: resume.page - 1,
      totalExtracted: 0,
      duplicatesSkipped: 0,
      seenHashes: [],
      visitedUrls: resume.visitedUrls,
      lastUrl: resume.startUrl,
      savedAt: Date.now(),
      scrollsCompleted: resume.scrollsCompleted,
      catchUpScrolls: resume.catchUpScrolls,
    },
    onPageExtracted: async (batch) => {
      visitedUrls = Array.from(new Set([...visitedUrls, normalizeUrlForDeduplication(batch.url)]));
      scrollsAtLastBatch = batch.scrollsCompleted;
      const commit = await commitBatch({
        page: batch.page,
        records: batch.records,
        stats: {
          detected: batch.detectedCount,
          missingFields: batch.missingFieldCount,
          filtered: batch.filteredCount,
          failed: batch.failedCount,
          duplicates: batch.duplicatesCount,
        },
        navigation: {
          nextPage: batch.page + 1,
          scrollsCompleted: batch.scrollsCompleted,
          awaitingNavigation: false,
          visitedUrls,
          url: batch.url,
          isCatchUp: batch.isCatchUp,
        },
      });
      return { inserted: commit.inserted, stop: commit.shouldStop };
    },
    beforeNavigate: async ({ href, page }) => {
      await commitCheckpoint({
        nextPage: page,
        scrollsCompleted: scrollsAtLastBatch,
        awaitingNavigation: true,
        expectedUrl: href,
        visitedUrls,
        url: getCurrentUrl(),
      });
    },
  });

  if (result.stopReason === 'cancelled') return { kind: 'cancelled' };
  if (result.stopReason === 'navigation_failure') {
    throw new NavigationJobError(result.error ?? 'The next page could not be opened.');
  }
  return { kind: 'finished', stopReason: result.stopReason };
}

/**
 * Runs a job on the current document until it finishes, is cancelled, or moves to
 * another document. Limits come only from the recipe saved on the job.
 */
export async function runNavigationJob(options: NavigationJobOptions): Promise<NavigationJobOutcome> {
  assertValidContainer(options.recipe, options.root);

  switch (options.recipe.pagination.type) {
    case 'none':
      return runSinglePageJob(options);
    case 'url_template':
      return runUrlTemplateJob(options);
    case 'next_button':
    case 'infinite_scroll':
      return runEngineJob(options);
  }
}

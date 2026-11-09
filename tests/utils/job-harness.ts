import { JobCoordinator, JobCoordinatorDeps, JobTransport } from '@/background/job-coordinator';
import { registerJobHandlers } from '@/background/register-job-handlers';
import {
  ContentWorkflowCoordinator,
  ContentWorkflowOptions,
  createContentWorkflowCoordinator,
} from '@/content/workflow-coordinator';
import { BatchAck, ExtensionMessage, extensionMessageSchema } from '@/contracts/messages';
import { MessageRouter } from '@/platform/message-router';
import { JobIdentity } from '@/shared/contracts/job';
import { ExtractionSchema } from '@/shared/contracts/schema';
import { PaginationConfig } from '@/shared/contracts/pagination';
import { PageHarvestDB } from '@/storage/db';
import { codeForCategory } from '@/core/resilience/error-reporter';
import type { ExtractionErrorCode } from '@/shared/contracts/error';
import type { ErrorCategory } from '@/types';

/**
 * Runs the real background coordinator against the real content runtime, over real
 * IndexedDB (fake-indexeddb). Only what a browser would provide is simulated: delivering
 * messages between contexts, tabs, and replacing a tab's document on navigation.
 *
 * Every message passes through JSON and the protocol schema, as it would between
 * extension contexts, so an invalid message fails here too.
 */
export const BASE_URL = 'http://localhost:3000';

export function uniqueDb(): PageHarvestDB {
  return new PageHarvestDB(`HarnessDB_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
}

export function makeRecipe(
  pagination: Partial<PaginationConfig> = {},
  overrides: Partial<ExtractionSchema> = {}
): ExtractionSchema {
  return {
    id: 'recipe_test',
    name: 'Test extraction',
    urlPattern: `${BASE_URL}/*`,
    containerSelector: '.card',
    fields: [
      { id: 't', name: 'Title', selector: '.title', extractor: 'text', required: false, transform: 'trim' },
    ],
    pagination: {
      type: 'none',
      maxPages: 20,
      delayMs: 200,
      scrollCount: 30,
      scrollDelayMs: 300,
      startPage: 1,
      pageIncrement: 1,
      stopCondition: 'no_new_records',
      ...pagination,
    },
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

export function renderCards(titles: string[], extra: string = ''): void {
  document.body.innerHTML = `
    <section>${titles.map((title) => `<article class="card"><h2 class="title">${title}</h2></article>`).join('')}</section>
    ${extra}
  `;
}

/** Copies a message the way crossing an extension boundary does, and validates it. */
function acrossBoundary(message: unknown): ExtensionMessage {
  return extensionMessageSchema.parse(JSON.parse(JSON.stringify(message)));
}

export interface HarnessPage {
  coordinator: ContentWorkflowCoordinator;
  tabId: number;
}

export class ExtensionHarness {
  public readonly db: PageHarvestDB;
  public coordinator: JobCoordinator;
  public readonly broadcasts: ExtensionMessage[] = [];
  public readonly navigations: Array<{ tabId: number; url: string }> = [];
  public readonly injections: number[] = [];
  /** Tabs showing a document that has no content script yet but can be scripted. */
  public readonly unscriptedDocuments = new Map<number, string>();
  /** Called with each page the background starts by injecting, so tests can spy on it. */
  public onInject: (page: HarnessPage) => void = () => undefined;
  public readonly closedTabs = new Set<number>();
  public readonly tabsWithoutContent = new Set<number>();
  public readonly tabLoadStatus = new Map<number, string>();
  /** Set to make the background unreachable, as while a worker restarts. */
  public backgroundDown = false;
  /** Called when a tab is told to navigate. Defaults to doing nothing further. */
  public onNavigate: (tabId: number, url: string) => void = () => undefined;

  private pages = new Map<number, HarnessPage>();
  private currentUrls = new Map<number, string>();
  private nextTabId = 500;
  private readonly deps: Partial<JobCoordinatorDeps>;
  public readonly transport: JobTransport;

  constructor(deps: Partial<JobCoordinatorDeps> = {}, db: PageHarvestDB = uniqueDb()) {
    this.db = db;
    this.deps = deps;
    this.transport = {
      sendToTab: async (tabId, message) => {
        if (this.closedTabs.has(tabId) || this.tabsWithoutContent.has(tabId)) {
          throw new Error('Could not establish connection. Receiving end does not exist.');
        }
        return this.deliverToPage(tabId, acrossBoundary(message));
      },
      broadcast: async (message) => {
        this.broadcasts.push(acrossBoundary(message));
      },
      openBlankTab: async () => {
        const tabId = this.nextTabId++;
        this.tabsWithoutContent.add(tabId);
        return tabId;
      },
      navigateTab: async (tabId, url) => {
        this.navigations.push({ tabId, url });
        this.onNavigate(tabId, url);
      },
      getTabLoadStatus: async (tabId) =>
        this.closedTabs.has(tabId) ? null : (this.tabLoadStatus.get(tabId) ?? 'complete'),
      injectContentScript: async (tabId) => {
        if (this.closedTabs.has(tabId)) {
          throw new Error('No tab with id: ' + tabId + '.');
        }
        this.injections.push(tabId);
        // Like chrome.scripting with the content script's __PAGEHARVEST_INJECTED__ flag:
        // a document that already runs the script is left alone.
        if (this.pages.has(tabId)) {
          return { injected: false, url: this.currentUrls.get(tabId) ?? BASE_URL };
        }
        const url = this.unscriptedDocuments.get(tabId);
        if (url === undefined) {
          // tabsWithoutContent: a page Chrome will not script (error page, other site).
          throw new Error('Cannot access contents of the page.');
        }
        this.unscriptedDocuments.delete(tabId);
        this.onInject(this.loadPage(tabId, url));
        return { injected: true, url };
      },
    };
    this.coordinator = this.createCoordinator();
  }

  private createCoordinator(): JobCoordinator {
    return new JobCoordinator({
      db: this.db,
      transport: this.transport,
      checkPermissions: async () => ({ allGranted: true, missing: [] }),
      reporter: { report: quietReporter },
      ...this.deps,
    });
  }

  /** Simulates the service worker being stopped and started: nothing in memory survives. */
  public restartServiceWorker(): void {
    this.coordinator = this.createCoordinator();
  }

  /** Loads a document in a tab and starts a content script for it, like a real page load. */
  public loadPage(
    tabId: number,
    url: string,
    options: Partial<ContentWorkflowOptions> = {}
  ): HarnessPage {
    this.currentUrls.set(tabId, url);
    this.tabsWithoutContent.delete(tabId);
    const page = { tabId } as HarnessPage;
    const coordinator = createContentWorkflowCoordinator(
      () => undefined,
      document,
      {
        // jsdom keeps one document, so a replaced page's run can keep going. In a browser that
        // document is destroyed and sends nothing; this makes the harness behave the same way.
        sendToBackground: (message) =>
          this.pages.get(tabId) === page
            ? this.deliverFromPage(tabId, message)
            : Promise.reject(new Error('This document was unloaded and can no longer send.')),
        getCurrentUrl: () => this.currentUrls.get(tabId) ?? url,
        navigateUrl: (target) => {
          this.navigations.push({ tabId, url: target });
          this.onNavigate(tabId, target);
        },
        deliveryAttempts: 3,
        deliveryRetryDelayMs: 1,
        engineOverrides: { pageTimeoutMs: 100, navigationTimeoutMs: 20 },
        ...options,
      }
    );
    page.coordinator = coordinator;
    this.pages.set(tabId, page);
    return page;
  }

  /**
   * A new document loaded in the tab and, as in Chrome since ADR-037, runs no content
   * script until the background injects one (JobCoordinator.handleTabLoaded).
   */
  public loadUnscriptedPage(tabId: number, url: string): void {
    this.pages.delete(tabId);
    this.currentUrls.set(tabId, url);
    this.tabsWithoutContent.add(tabId);
    this.unscriptedDocuments.set(tabId, url);
  }

  /** The document is gone. Its content script no longer receives anything. */
  public unloadPage(tabId: number): void {
    this.pages.delete(tabId);
    this.tabsWithoutContent.add(tabId);
  }

  public closeTab(tabId: number): void {
    this.closedTabs.add(tabId);
    this.pages.delete(tabId);
  }

  /** Reports a page load to the background, as a new content script does on startup. */
  public async announceReady(tabId: number): Promise<void> {
    await this.coordinator.handleContentReady(this.currentUrls.get(tabId) ?? BASE_URL, tabId);
  }

  public async settled(tabId: number): Promise<void> {
    await this.pages.get(tabId)?.coordinator.runSettled();
  }

  /** Delivers a message as if the page in this tab sent it, with no retry. */
  public async sendFromPage(tabId: number, message: unknown): Promise<BatchAck> {
    return (await this.deliverFromPage(tabId, acrossBoundary(message))) as BatchAck;
  }

  private async deliverFromPage(tabId: number, raw: ExtensionMessage): Promise<unknown> {
    if (this.backgroundDown) {
      throw new Error('Could not establish connection. Receiving end does not exist.');
    }
    const message = acrossBoundary(raw);
    const sender = { tabId };
    switch (message.type) {
      case 'RECORD_BATCH':
        return this.coordinator.commitBatch(message.payload, sender);
      case 'JOB_CHECKPOINT':
        return this.coordinator.commitCheckpoint(message.payload, sender);
      case 'JOB_FINISHED':
        return this.coordinator.completeJob(message.payload, sender);
      case 'JOB_FAILED':
        return this.coordinator.reportJobFailure(message.payload, sender);
      default:
        return undefined;
    }
  }

  private deliverToPage(tabId: number, message: ExtensionMessage): unknown {
    const page = this.pages.get(tabId);
    if (!page) {
      throw new Error('Could not establish connection. Receiving end does not exist.');
    }
    switch (message.type) {
      case 'EXTRACT_RECORDS':
        return page.coordinator.extractRecords(message);
      case 'CONTROL_JOB':
        return page.coordinator.controlJob(message);
      case 'QUERY_JOB_RUN':
        return page.coordinator.queryJobRun();
      default:
        return undefined;
    }
  }

  public async start(
    tabId: number,
    recipe: ExtractionSchema,
    sourceUrl: string = this.currentUrls.get(tabId) ?? BASE_URL,
    extra: { projectId?: string; recipeId?: string } = {}
  ): Promise<JobIdentity> {
    const result = await this.coordinator.startJob({ recipe, tabId, sourceUrl, ...extra });
    if (!result.ok || !result.identity) {
      throw new Error(`startJob failed: ${result.error}`);
    }
    return result.identity;
  }

  public rows(datasetId: string) {
    return this.db.getDatasetRecords(datasetId);
  }

  public async titles(datasetId: string): Promise<unknown[]> {
    return (await this.rows(datasetId)).map((row) => row.Title);
  }

  public job(jobId: string) {
    return this.db.jobs.get(jobId);
  }

  public checkpoint(jobId: string) {
    return this.db.checkpoints.get(jobId);
  }
}

/** The real reporter's output, without its console noise or shared history. */
function quietReporter(
  category: ErrorCategory,
  error: unknown,
  options: { code?: ExtractionErrorCode } = {}
) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    id: `err_${Math.random().toString(36).slice(2, 10)}`,
    category,
    severity: 'ERROR' as const,
    code: options.code ?? codeForCategory(category),
    message,
    timestamp: Date.now(),
  };
}

export function makeBatch(
  identity: JobIdentity,
  sequence: number,
  titles: string[],
  overrides: Record<string, unknown> = {}
): ExtensionMessage {
  return {
    id: `batch_${sequence}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'RECORD_BATCH',
    timestamp: 1,
    payload: {
      identity,
      sequence,
      page: sequence,
      records: titles.map((title, index) => ({
        _id: `temp_${sequence}_${index}`,
        _page: sequence,
        _extractedAt: 1,
        Title: title,
      })),
      stats: { detected: titles.length, missingFields: 0, filtered: 0, failed: 0, duplicates: 0 },
      navigation: {
        nextPage: sequence + 1,
        scrollsCompleted: 0,
        awaitingNavigation: false,
        visitedUrls: [],
        url: `${BASE_URL}/page-${sequence}`,
      },
      ...overrides,
    },
  } as ExtensionMessage;
}

/**
 * Connects the real router and coordinator to the Chrome mock, so a panel running in
 * the same test talks to a real background through chrome.runtime.sendMessage.
 */
export function installBackground(
  db: PageHarvestDB,
  deps: Partial<JobCoordinatorDeps> = {}
): { coordinator: JobCoordinator; router: MessageRouter; transport: JobTransport } {
  const transport: JobTransport = {
    sendToTab: async () => ({ accepted: true }),
    broadcast: async () => undefined,
    openBlankTab: async () => 900,
    navigateTab: async () => undefined,
    getTabLoadStatus: async () => 'complete',
    injectContentScript: async () => ({ injected: false, url: BASE_URL }),
  };
  const coordinator = new JobCoordinator({
    db,
    transport,
    checkPermissions: async () => ({ allGranted: true, missing: [] }),
    reporter: { report: quietReporter },
    ...deps,
  });
  const router = new MessageRouter();
  registerJobHandlers(router, coordinator);
  router.listen();
  return { coordinator, router, transport };
}

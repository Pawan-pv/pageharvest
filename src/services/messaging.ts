import { CandidateKind } from '@/shared/contracts/message';
import type { MultiAnchorSelector } from '@/shared/contracts/selector';
import {
  ExtensionMessage,
  FieldPreviewResult,
  FieldPreviewResultSchema,
  JobCommandResult,
  JobCommandResultSchema,
  PREVIEW_ROW_LIMIT,
  extensionMessageSchema,
} from '@/contracts/messages';
import { MessagingClient } from '@/platform/messaging-client';
import { injectContentScript } from '@/platform/content-script';
import { hasAllSitesAccess, requestSiteOrigin, SITE_PERMISSION_MESSAGE } from '@/platform/permissions';
import { isHarvestableUrl } from '@/platform/tab-manager';
import { JobIdentity } from '@/shared/contracts/job';
import { ExtractionRecipe, FieldDefinition } from '@/types';

export { SITE_PERMISSION_MESSAGE };

export class SitePermissionError extends Error {
  code = 'SITE_PERMISSION_REQUIRED' as const;
  constructor(message = SITE_PERMISSION_MESSAGE) {
    super(message);
    this.name = 'SitePermissionError';
  }
}

export function isSitePermissionError(error: unknown): error is SitePermissionError {
  if (error instanceof SitePermissionError) return true;
  if (typeof error !== 'object' || error === null) return false;
  return (error as { code?: unknown }).code === 'SITE_PERMISSION_REQUIRED';
}

export async function injectContentScriptIntoTab(tabId: number): Promise<void> {
  await injectContentScript(tabId);
}

/**
 * Ensures the content script is present for picking / preview / detection.
 * Uses the activeTab grant (no prompt) when the toolbar click gave one; falls
 * back to a site-origin request. Restricted pages keep TAB_DISCONNECTED.
 */
export async function ensureContentScriptForPicking(tab: { id?: number; url: string }): Promise<void> {
  if (typeof tab.id !== 'number') throw new SitePermissionError();
  if (!isHarvestableUrl(tab.url)) {
    throw new Error(`Cannot harvest restricted URL "${tab.url || 'unknown'}". Extensions cannot run on internal or web store pages.`);
  }
  if (!tab.url) throw new SitePermissionError();
  try {
    await injectContentScriptIntoTab(tab.id);
  } catch {
    const granted = await requestSiteOrigin(tab.url);
    if (!granted) throw new SitePermissionError();
    await injectContentScriptIntoTab(tab.id);
  }
}

function generateId(): string {
  return 'msg_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now();
}

const TAB_MESSAGE_TIMEOUT_MS = 15_000;
const JOB_COMMAND_TIMEOUT_MS = 20_000;
/** A preview is a convenience: it gives up quickly rather than hold the panel. */
const PREVIEW_TIMEOUT_MS = 4_000;

export interface TabInfo {
  id?: number;
  url: string;
  title: string;
  isInjectable: boolean;
  /**
   * Chrome hides the page's address because the user has limited PageHarvest's site access
   * in Chrome's settings. A click on the toolbar button grants it for the page. While every
   * website is allowed (the installed state, ADR-040) a hidden address is a browser page,
   * which no click can open up, so this stays false.
   */
  needsAccess?: boolean;
}

export interface StartJobRequest {
  recipe: ExtractionRecipe;
  tabId: number;
  sourceUrl: string;
  pageTitle?: string;
  projectId?: string;
  recipeId?: string;
}

/** Where a message came from. `tabId` is set for a page's content script, unset for extension pages. */
export interface MessageOrigin {
  tabId?: number;
}

export type MessageListener = (message: ExtensionMessage, origin?: MessageOrigin) => void;

/**
 * The side panel's connection to the rest of the extension. Delivery, validation and
 * timeouts belong to MessagingClient; this adds the panel's own vocabulary on top.
 */
class ExtensionMessagingService {
  private listeners: Set<MessageListener> = new Set();
  private client = new MessagingClient();

  constructor() {
    this.initRuntimeListener();
  }

  private initRuntimeListener() {
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((message: unknown, sender?: chrome.runtime.MessageSender) => {
        const parsed = extensionMessageSchema.safeParse(message);
        if (parsed.success) {
          this.notifyListeners(parsed.data, { tabId: sender?.tab?.id });
        }
      });
    }
  }

  public subscribe(listener: MessageListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(message: ExtensionMessage, origin: MessageOrigin) {
    this.listeners.forEach((listener) => {
      try {
        listener(message, origin);
      } catch (err) {
        console.error('Error in message listener:', err);
      }
    });
  }

  /**
   * Retrieves the current active tab and checks if PageHarvest can inspect it.
   */
  public async getActiveTab(): Promise<TabInfo> {
    if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs.length > 0 && tabs[0]) {
          const tab = tabs[0];
          let url = tab.url || '';
          let title = tab.title || 'Untitled Page';

          // Chrome exposes the sensitive URL/title fields after an activeTab
          // grant. A directly opened sidepanel document (including automated
          // release runs) can see the active tab ID before that grant exists.
          // The already-loaded content script can provide the same local
          // metadata without requesting the broad `tabs` permission.
          if (!url && typeof tab.id === 'number' && chrome.tabs.sendMessage) {
            try {
              const response = await chrome.tabs.sendMessage(tab.id, {
                id: `active_tab_ping_${Date.now()}`,
                type: 'PING',
                timestamp: Date.now(),
                payload: {},
              });
              if (typeof response === 'object' && response !== null) {
                const pong = response as {
                  payload?: { url?: unknown; title?: unknown };
                };
                if (typeof pong.payload?.url === 'string') url = pong.payload.url;
                if (typeof pong.payload?.title === 'string' && pong.payload.title) {
                  title = pong.payload.title;
                }
              }
            } catch {
              // Restricted pages and pages without the content script remain
              // non-injectable and are handled by the normal status path.
            }
          }
          return {
            id: tab.id,
            url,
            title: url ? title : 'This page',
            isInjectable: isHarvestableUrl(url),
            // Asked only for a hidden address: every website's address is visible while
            // PageHarvest holds the access it was installed with.
            needsAccess: !url && typeof tab.id === 'number' && !(await hasAllSitesAccess()),
          };
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Could not query the active tab via Chrome: ${message}`, { cause: err });
      }
    }

    throw new Error('No active tab is available for PageHarvest.');
  }

  /**
   * Sends a typed message to the content script of a tab: the one named, or else the active
   * tab. A message about a list the user found names the tab it was found in, so it never
   * reaches a page the user switched to afterwards.
   */
  public async sendToActiveTab(message: ExtensionMessage, tabId?: number): Promise<unknown> {
    const validated = extensionMessageSchema.parse(message);

    if (typeof chrome === 'undefined' || !chrome.tabs?.sendMessage) {
      throw new Error('Chrome tab messaging is unavailable in this runtime.');
    }

    let targetTabId = tabId;
    if (targetTabId === undefined) {
      const tab = await this.getActiveTab();
      if (!tab.id || !tab.isInjectable) {
        throw new Error(`Cannot communicate with tab ${tab.url}. Extraction is only available on web pages.`);
      }
      targetTabId = tab.id;
    }

    try {
      return await this.client.sendToTab<unknown>(targetTabId, validated, {
        timeoutMs: TAB_MESSAGE_TIMEOUT_MS,
      });
    } catch (err) {
      // If content script is not yet injected or tab is restricted
      throw new Error(
        'Could not communicate with the page content script. Please refresh the page or ensure permissions are granted.',
        { cause: err }
      );
    }
  }

  public async startElementPicker(tabId?: number): Promise<void> {
    await this.sendToActiveTab(
      {
        id: generateId(),
        timestamp: Date.now(),
        type: 'START_PICKER',
        payload: { highlightColor: '#16a34a' },
      },
      tabId
    );
  }

  public async stopElementPicker(tabId?: number): Promise<void> {
    await this.sendToActiveTab(
      {
        id: generateId(),
        timestamp: Date.now(),
        type: 'STOP_PICKER',
        payload: {},
      },
      tabId
    );
  }

  public async detectRepeatedElements(
    targetSelector?: string,
    mode?: 'table' | 'links',
    tabId?: number
  ): Promise<void> {
    await this.sendToActiveTab(
      {
        id: generateId(),
        timestamp: Date.now(),
        type: 'DETECT_REPEATED_ELEMENTS',
        payload: { targetSelector, mode },
      },
      tabId
    );
  }

  /**
   * Asks the page for the first rows with these fields (ADR-030). Read-only on the page side.
   * Never throws: every failure comes back as a coded result the panel can explain.
   */
  public async previewFields(
    containerSelector: string,
    fields: FieldDefinition[],
    options: { limit?: number; timeoutMs?: number; containerAnchor?: MultiAnchorSelector; tabId?: number } = {}
  ): Promise<FieldPreviewResult> {
    const message = extensionMessageSchema.safeParse({
      id: generateId(),
      timestamp: Date.now(),
      type: 'PREVIEW_FIELDS',
      payload: {
        containerSelector,
        containerAnchor: options.containerAnchor,
        fields,
        limit: options.limit ?? PREVIEW_ROW_LIMIT,
      },
    });
    if (!message.success) {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        message: 'These columns cannot be previewed yet. Check that each Pattern and Attribute column is filled in.',
      };
    }

    let tabId = options.tabId;
    if (tabId === undefined) {
      let tab: TabInfo;
      try {
        tab = await this.getActiveTab();
      } catch {
        return { ok: false, code: 'TAB_DISCONNECTED', message: 'There is no page to preview.' };
      }
      if (!tab.id || !tab.isInjectable) {
        return { ok: false, code: 'TAB_DISCONNECTED', message: 'PageHarvest cannot read this tab.' };
      }
      tabId = tab.id;
    }

    // On-demand injection (ADR-037): ensure the document has a content script.
    // TAB_DISCONNECTED keeps its meaning (timeout after injection); a missing
    // grant is SITE_PERMISSION_REQUIRED only.
    try {
      await injectContentScriptIntoTab(tabId);
    } catch {
      return {
        ok: false,
        code: 'SITE_PERMISSION_REQUIRED',
        message: SITE_PERMISSION_MESSAGE,
      };
    }

    let reply: unknown;
    try {
      reply = await this.client.sendToTab<unknown>(tabId, message.data, {
        timeoutMs: options.timeoutMs ?? PREVIEW_TIMEOUT_MS,
        retries: 0,
      });
    } catch {
      return { ok: false, code: 'TAB_DISCONNECTED', message: 'The page did not answer in time.' };
    }

    const parsed = FieldPreviewResultSchema.safeParse(reply);
    return parsed.success
      ? parsed.data
      : { ok: false, code: 'UNKNOWN_ERROR', message: 'The page sent a preview PageHarvest could not read.' };
  }

  public async detectFields(containerSelector: string, kind?: CandidateKind, tabId?: number): Promise<void> {
    await this.sendToActiveTab(
      {
        id: generateId(),
        timestamp: Date.now(),
        type: 'DETECT_FIELDS',
        payload: { containerSelector, kind },
      },
      tabId
    );
  }

  /**
   * Asks the background to create and start a job. Resolves only once the job is
   * durably stored, and rejects with the reason when it could not start.
   */
  public async startJob(request: StartJobRequest): Promise<JobIdentity> {
    const result = await this.sendJobCommand(
      extensionMessageSchema.parse({
        id: generateId(),
        timestamp: Date.now(),
        type: 'START_JOB',
        payload: request,
      })
    );
    if (!result.identity) {
      throw new Error('The background worker did not return a job.');
    }
    return result.identity;
  }

  public async pauseJob(jobId: string): Promise<void> {
    await this.sendSimpleJobCommand('PAUSE_JOB', jobId);
  }

  public async resumeJob(jobId: string): Promise<void> {
    await this.sendSimpleJobCommand('RESUME_JOB', jobId);
  }

  public async cancelJob(jobId: string): Promise<void> {
    await this.sendSimpleJobCommand('CANCEL_JOB', jobId);
  }

  public async finishJob(jobId: string): Promise<void> {
    await this.sendSimpleJobCommand('FINISH_JOB', jobId);
  }

  public async recoverJob(jobId: string): Promise<void> {
    await this.sendSimpleJobCommand('RECOVER_JOB', jobId);
  }

  public async discardJob(jobId: string): Promise<void> {
    await this.sendSimpleJobCommand('DISCARD_JOB', jobId);
  }

  /** Asks the background to re-check running jobs against their tabs. */
  public async reconcileJobs(): Promise<void> {
    await this.client.sendToBackground<unknown>(
      { id: generateId(), timestamp: Date.now(), type: 'RECONCILE_JOBS', payload: {} },
      { timeoutMs: JOB_COMMAND_TIMEOUT_MS }
    );
  }

  private async sendSimpleJobCommand(
    type: 'PAUSE_JOB' | 'RESUME_JOB' | 'CANCEL_JOB' | 'FINISH_JOB' | 'RECOVER_JOB' | 'DISCARD_JOB',
    jobId: string
  ): Promise<JobCommandResult> {
    return this.sendJobCommand({
      id: generateId(),
      timestamp: Date.now(),
      type,
      payload: { jobId },
    });
  }

  private async sendJobCommand(message: ExtensionMessage): Promise<JobCommandResult> {
    const reply = await this.client.sendToBackground<unknown>(message, {
      timeoutMs: JOB_COMMAND_TIMEOUT_MS,
      retries: 1,
      retryDelayMs: 300,
    });
    const parsed = JobCommandResultSchema.safeParse(reply);
    if (!parsed.success) {
      throw new Error('The background worker did not confirm the request.');
    }
    if (!parsed.data.ok) {
      throw new Error(parsed.data.error ?? 'The request could not be completed.');
    }
    return parsed.data;
  }
}

export const messagingService = new ExtensionMessagingService();

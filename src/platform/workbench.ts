import type { ToolType } from '@/shared/contracts/tool-job';

/**
 * The full-tab workbench lives at table.html. The side panel opens it for a dataset or a
 * tool, and reuses the tab that is already open instead of piling up copies.
 */
const WORKBENCH_PAGE = 'table.html';

export interface WorkbenchTarget {
  datasetId?: string;
  tool?: ToolType;
}

export interface WorkbenchOpenResult {
  tabId: number;
  /** True when an already-open workbench tab was reused and pointed at the new target. */
  reused: boolean;
}

export function workbenchUrl(target: WorkbenchTarget = {}): string {
  const params = new URLSearchParams();
  if (target.datasetId) params.set('datasetId', target.datasetId);
  if (target.tool) params.set('tool', target.tool);
  const query = params.toString();
  return chrome.runtime.getURL(`/${WORKBENCH_PAGE}${query ? `?${query}` : ''}`);
}

/** The query `chrome.tabs.query` uses to find a workbench tab of this extension. */
export function workbenchTabPattern(): string {
  return `${chrome.runtime.getURL(`/${WORKBENCH_PAGE}`)}*`;
}

async function findWorkbenchTab(): Promise<chrome.tabs.Tab | null> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) return null;
  try {
    const tabs = await chrome.tabs.query({ url: workbenchTabPattern() });
    return tabs.find((tab) => typeof tab.id === 'number') ?? null;
  } catch {
    // Querying own extension pages is expected to work; if a browser refuses, opening a
    // new tab is still correct, just less tidy.
    return null;
  }
}

/**
 * Opens the workbench on a dataset or a tool. An existing workbench tab is focused and
 * navigated to the requested target, so the panel never leaves duplicates behind.
 */
export async function openWorkbench(target: WorkbenchTarget = {}): Promise<WorkbenchOpenResult> {
  const url = workbenchUrl(target);
  const existing = await findWorkbenchTab();

  if (existing && typeof existing.id === 'number') {
    await chrome.tabs.update(existing.id, { url, active: true });
    if (typeof existing.windowId === 'number' && chrome.windows?.update) {
      await chrome.windows.update(existing.windowId, { focused: true }).catch(() => undefined);
    }
    return { tabId: existing.id, reused: true };
  }

  const tab = await chrome.tabs.create({ url, active: true });
  if (typeof tab.id !== 'number') {
    throw new Error('Chrome did not return a tab ID for the workbench.');
  }
  return { tabId: tab.id, reused: false };
}

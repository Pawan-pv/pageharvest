import { describe, it, expect, beforeEach } from 'vitest';
import { createChromeMock, ChromeMock } from '../utils/chrome-mock';
import { openWorkbench, workbenchTabPattern, workbenchUrl } from '@/platform/workbench';

describe('workbench URL helpers', () => {
  it('builds a workbench URL with no target', () => {
    expect(workbenchUrl()).toContain('/table.html');
    expect(workbenchUrl()).not.toContain('?');
  });

  it('builds a workbench URL for a dataset', () => {
    expect(workbenchUrl({ datasetId: 'ds_1' })).toBe(
      'chrome-extension://pageharvest-mock-extension-id/table.html?datasetId=ds_1'
    );
  });

  it('builds a workbench URL for a tool', () => {
    expect(workbenchUrl({ tool: 'links' })).toBe(
      'chrome-extension://pageharvest-mock-extension-id/table.html?tool=links'
    );
  });

  it('builds a workbench URL for both', () => {
    expect(workbenchUrl({ datasetId: 'ds_1', tool: 'links' })).toBe(
      'chrome-extension://pageharvest-mock-extension-id/table.html?datasetId=ds_1&tool=links'
    );
  });

  it('returns a match pattern for finding existing workbench tabs', () => {
    expect(workbenchTabPattern()).toBe('chrome-extension://pageharvest-mock-extension-id/table.html*');
  });
});

describe('openWorkbench', () => {
  let mockChrome: ChromeMock;

  beforeEach(() => {
    mockChrome = createChromeMock();
    Reflect.set(globalThis, 'chrome', mockChrome);
  });

  it('reuses an existing workbench tab and navigates it to the new target', async () => {
    mockChrome.openTabs.set(200, {
      ...mockChrome.activeTab,
      id: 200,
      windowId: 7,
      url: 'chrome-extension://pageharvest-mock-extension-id/table.html?datasetId=old',
      status: 'complete',
    } as chrome.tabs.Tab);

    const result = await openWorkbench({ datasetId: 'ds_1' });

    expect(result).toEqual({ tabId: 200, reused: true });
    // The existing tab was updated with the new URL.
    const updated = mockChrome.openTabs.get(200);
    expect(updated?.url).toContain('datasetId=ds_1');
    expect(updated?.active).toBe(true);
    expect(mockChrome.windows.update).toHaveBeenCalledWith(7, { focused: true });
  });

  it('creates a new tab when no workbench tab is open', async () => {
    const result = await openWorkbench({ tool: 'links' });

    expect(result.reused).toBe(false);
    expect(typeof result.tabId).toBe('number');
    const created = mockChrome.openTabs.get(result.tabId);
    expect(created?.url).toContain('tool=links');
    expect(created?.active).toBe(true);
  });
});

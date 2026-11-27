import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useActiveTab } from '@/hooks/useActiveTab';
import { messagingService, type TabInfo } from '@/services/messaging';

const hidden: TabInfo = { id: 7, url: '', title: 'This page', isInjectable: false, needsAccess: true };
const shared: TabInfo = { id: 7, url: 'https://shop.test/items', title: 'Shop', isInjectable: true, needsAccess: false };

describe('useActiveTab while Chrome hides the page (ADR-037)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('looks again quietly until the toolbar click shares the page', async () => {
    vi.useFakeTimers();
    const getActiveTab = vi.spyOn(messagingService, 'getActiveTab').mockResolvedValue(hidden);
    const { result } = renderHook(() => useActiveTab());
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.tab.needsAccess).toBe(true);

    getActiveTab.mockResolvedValue(shared);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(result.current.tab).toEqual(shared);
    expect(result.current.isLoading).toBe(false);

    // Access granted: no more polling.
    const callsAfterGrant = getActiveTab.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(getActiveTab.mock.calls.length).toBe(callsAfterGrant);
  });

  it('keeps the newest answer when an older look at the tab finishes last', async () => {
    // A tab that is still blank shows no address, so the look falls back to asking the page,
    // which can take longer than the look that follows once the page has loaded.
    const blank: TabInfo = { id: 8, url: '', title: 'This page', isInjectable: false };
    const loaded: TabInfo = { id: 8, url: 'https://shop.test/items', title: 'Shop', isInjectable: true };
    const pending: Array<(tab: TabInfo) => void> = [];
    vi.spyOn(messagingService, 'getActiveTab').mockImplementation(
      () => new Promise<TabInfo>((resolve) => pending.push(resolve))
    );

    const { result } = renderHook(() => useActiveTab());
    // The panel opens, then the user opens a tab and the page in it finishes loading.
    act(() => {
      chromeMock.triggerTabActivated({ tabId: 8, windowId: 1 });
      chromeMock.triggerTabUpdated(8, { status: 'complete' }, { id: 8 } as chrome.tabs.Tab);
    });
    expect(pending).toHaveLength(3);

    await act(async () => {
      pending[2](loaded); // the newest look answers first
      pending[0]({ id: 1, url: 'chrome-extension://panel/sidepanel.html', title: 'PageHarvest', isInjectable: false });
      pending[1](blank); // the look at the blank tab answers last
      await Promise.resolve();
    });

    expect(result.current.tab).toEqual(loaded);
    expect(result.current.isLoading).toBe(false);
  });

  it('does not let a slow access re-check overwrite a newer look', async () => {
    vi.useFakeTimers();
    const getActiveTab = vi.spyOn(messagingService, 'getActiveTab').mockResolvedValue(hidden);
    const { result } = renderHook(() => useActiveTab());
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.tab.needsAccess).toBe(true);

    // The re-check starts and is slow; meanwhile the user switches to another site.
    let finishRecheck!: (tab: TabInfo) => void;
    getActiveTab.mockImplementationOnce(() => new Promise<TabInfo>((resolve) => (finishRecheck = resolve)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    const other: TabInfo = { id: 9, url: 'https://news.test/', title: 'News', isInjectable: true, needsAccess: false };
    getActiveTab.mockResolvedValue(other);
    await act(async () => {
      chromeMock.triggerTabActivated({ tabId: 9, windowId: 1 });
      await Promise.resolve();
    });
    expect(result.current.tab).toEqual(other);

    await act(async () => {
      finishRecheck(shared); // what tab 7 looked like a moment ago
      await Promise.resolve();
    });
    expect(result.current.tab).toEqual(other);
  });

  it('does not poll for a page it can already see', async () => {
    vi.useFakeTimers();
    const getActiveTab = vi.spyOn(messagingService, 'getActiveTab').mockResolvedValue(shared);
    renderHook(() => useActiveTab());
    await act(async () => {
      await Promise.resolve();
    });
    const initialCalls = getActiveTab.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });

    expect(getActiveTab.mock.calls.length).toBe(initialCalls);
  });
});

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

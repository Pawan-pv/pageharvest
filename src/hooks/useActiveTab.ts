import { useState, useEffect, useCallback } from 'react';
import { messagingService, TabInfo } from '@/services/messaging';

const ACCESS_RECHECK_MS = 2_000;

export function useActiveTab() {
  const [tab, setTab] = useState<TabInfo>({
    url: '',
    title: 'Loading page...',
    isInjectable: false,
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refreshTab = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const activeTab = await messagingService.getActiveTab();
      setTab(activeTab);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to query active tab');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Clicking the toolbar button on a page grants access to it, but Chrome sends the
  // panel no event for that, so look again every few seconds while access is missing.
  useEffect(() => {
    if (!tab.needsAccess) return undefined;
    const timer = setInterval(() => {
      // Quiet: no loading state, so the refresh button does not spin every few seconds.
      messagingService
        .getActiveTab()
        .then((activeTab) => {
          if (!activeTab.needsAccess) setTab(activeTab);
        })
        .catch(() => undefined);
    }, ACCESS_RECHECK_MS);
    return () => clearInterval(timer);
  }, [tab.needsAccess]);

  useEffect(() => {
    refreshTab();

    // Listen to tab activation changes in Chrome
    if (typeof chrome !== 'undefined' && chrome.tabs?.onActivated) {
      const handleActivated = () => refreshTab();
      const handleUpdated = (
        _tabId: number,
        changeInfo: { status?: string; url?: string }
      ) => {
        if (changeInfo.status === 'complete' || changeInfo.url) {
          refreshTab();
        }
      };

      chrome.tabs.onActivated.addListener(handleActivated);
      chrome.tabs.onUpdated?.addListener(handleUpdated);

      return () => {
        chrome.tabs.onActivated.removeListener(handleActivated);
        chrome.tabs.onUpdated?.removeListener(handleUpdated);
      };
    }

    return undefined;
  }, [refreshTab]);

  return { tab, isLoading, error, refreshTab };
}

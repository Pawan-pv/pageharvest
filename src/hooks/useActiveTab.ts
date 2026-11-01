import { useState, useEffect, useCallback } from 'react';
import { messagingService, TabInfo } from '@/services/messaging';

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
  }, [refreshTab]);

  return { tab, isLoading, error, refreshTab };
}

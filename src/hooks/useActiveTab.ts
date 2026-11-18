import { useState, useEffect, useCallback, useRef } from 'react';
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
  // Every look at the tab takes a number, and only the newest may change what is shown. A look
  // at a tab that shows no address yet asks the page, which can answer after a later look: its
  // stale answer would otherwise stay on screen until the next tab event.
  const latestLook = useRef(0);

  const refreshTab = useCallback(async () => {
    const look = ++latestLook.current;
    setIsLoading(true);
    setError(null);
    try {
      const activeTab = await messagingService.getActiveTab();
      if (look === latestLook.current) setTab(activeTab);
    } catch (err) {
      if (look === latestLook.current) {
        setError(err instanceof Error ? err.message : 'Failed to query active tab');
      }
    } finally {
      if (look === latestLook.current) setIsLoading(false);
    }
  }, []);

  // Clicking the toolbar button on a page grants access to it, but Chrome sends the
  // panel no event for that, so look again every few seconds while access is missing.
  useEffect(() => {
    if (!tab.needsAccess) return undefined;
    const timer = setInterval(() => {
      const look = ++latestLook.current;
      // Quiet: no loading state, so the refresh button does not spin every few seconds.
      messagingService
        .getActiveTab()
        .then((activeTab) => {
          if (look === latestLook.current && !activeTab.needsAccess) setTab(activeTab);
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

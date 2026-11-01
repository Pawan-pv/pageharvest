export interface TabStatus {
  tabId?: number;
  isHarvestable: boolean;
  status: 'ready' | 'loading' | 'unsupported';
  url?: string;
  title?: string;
  reason?: string;
}

export type TabChangeListener = (status: TabStatus) => void;

/**
 * Checks if a given URL is eligible for content script extraction.
 * Enforces least-privilege security by refusing internal browser and store URLs.
 */
export function isHarvestableUrl(url?: string): boolean {
  if (!url || typeof url !== 'string') return false;

  const trimmed = url.trim().toLowerCase();

  // Forbidden schemes and protocols
  const restrictedProtocols = [
    'chrome://',
    'chrome-extension://',
    'devtools://',
    'edge://',
    'about:',
    'view-source:',
    'javascript:',
    'data:'
  ];

  for (const protocol of restrictedProtocols) {
    if (trimmed.startsWith(protocol)) return false;
  }

  // Chrome Web Store restriction
  if (
    trimmed.includes('chromewebstore.google.com') ||
    trimmed.includes('chrome.google.com/webstore')
  ) {
    return false;
  }

  // Must be standard web protocol or local file
  return (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('file://')
  );
}

/**
 * Retrieves the currently active tab in the current window.
 */
export async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) {
    return null;
  }

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs && tabs.length > 0 ? tabs[0] : null;
  } catch {
    return null;
  }
}

/**
 * Evaluates tab status and harvestability.
 */
export function getTabStatus(tab: chrome.tabs.Tab): TabStatus {
  const harvestable = isHarvestableUrl(tab.url);

  if (!harvestable) {
    return {
      tabId: tab.id,
      isHarvestable: false,
      status: 'unsupported',
      url: tab.url,
      title: tab.title,
      reason: 'Target page is a restricted browser internal or web store URL.'
    };
  }

  if (tab.status === 'loading') {
    return {
      tabId: tab.id,
      isHarvestable: true,
      status: 'loading',
      url: tab.url,
      title: tab.title
    };
  }

  return {
    tabId: tab.id,
    isHarvestable: true,
    status: 'ready',
    url: tab.url,
    title: tab.title
  };
}

/**
 * Manages tab lifecycle events and broadcasts updates to UI or Background listeners.
 */
export class TabManager {
  private listeners: Set<TabChangeListener> = new Set();
  private onActivatedHandler: any = null;
  private onUpdatedHandler: any = null;

  constructor() {
    this.setupListeners();
  }

  private setupListeners(): void {
    if (typeof chrome === 'undefined' || !chrome.tabs) return;

    this.onActivatedHandler = async (activeInfo: chrome.tabs.TabActiveInfo) => {
      const tab = await getActiveTab();
      if (tab) {
        this.notify(getTabStatus(tab));
      }
    };

    this.onUpdatedHandler = (
      tabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
      tab: chrome.tabs.Tab
    ) => {
      // Check if update is for the active tab
      if (tab.active) {
        this.notify(getTabStatus(tab));
      }
    };

    if (chrome.tabs.onActivated?.addListener) {
      chrome.tabs.onActivated.addListener(this.onActivatedHandler);
    }
    if (chrome.tabs.onUpdated?.addListener) {
      chrome.tabs.onUpdated.addListener(this.onUpdatedHandler);
    }
  }

  public subscribe(listener: TabChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(status: TabStatus): void {
    for (const listener of this.listeners) {
      try {
        listener(status);
      } catch (err) {
        console.error('Error in TabManager listener:', err);
      }
    }
  }

  public destroy(): void {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      if (chrome.tabs.onActivated?.removeListener && this.onActivatedHandler) {
        chrome.tabs.onActivated.removeListener(this.onActivatedHandler);
      }
      if (chrome.tabs.onUpdated?.removeListener && this.onUpdatedHandler) {
        chrome.tabs.onUpdated.removeListener(this.onUpdatedHandler);
      }
    }
    this.listeners.clear();
  }
}

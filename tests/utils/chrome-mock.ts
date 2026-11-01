import { vi } from 'vitest';

/**
 * High-fidelity Chrome Extension API Mock for Manifest V3 unit and integration testing.
 * Provides realistic message routing, storage, tab tracking, downloads, and event listeners.
 */

type MessageListener = (
  message: any,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: any) => void
) => boolean | void;

type TabActivatedListener = (activeInfo: chrome.tabs.TabActiveInfo) => void;
type TabUpdatedListener = (
  tabId: number,
  changeInfo: chrome.tabs.TabChangeInfo,
  tab: chrome.tabs.Tab
) => void;

export class ChromeMock {
  private runtimeListeners: Set<MessageListener> = new Set();
  private tabListeners: Map<number, Set<MessageListener>> = new Map();
  private tabActivatedListeners: Set<TabActivatedListener> = new Set();
  private tabUpdatedListeners: Set<TabUpdatedListener> = new Set();
  private localStorageData: Record<string, any> = {};
  public grantedPermissions: Set<string> = new Set(['activeTab', 'sidePanel', 'storage', 'scripting', 'downloads']);

  public activeTab: chrome.tabs.Tab = {
    id: 101,
    index: 0,
    windowId: 1,
    highlighted: true,
    active: true,
    pinned: false,
    incognito: false,
    url: 'http://127.0.0.1:3456/simple-grid.html',
    title: 'Simple Product Grid'
  };

  public runtime: any = {
    id: 'pageharvest-mock-extension-id',
    lastError: undefined as chrome.runtime.LastError | undefined,
    onMessage: {
      addListener: (listener: MessageListener) => {
        this.runtimeListeners.add(listener);
      },
      removeListener: (listener: MessageListener) => {
        this.runtimeListeners.delete(listener);
      },
      hasListener: (listener: MessageListener) => {
        return this.runtimeListeners.has(listener);
      }
    },
    sendMessage: (message: any, responseCallback?: (response: any) => void) => {
      let responded = false;
      const sendResponse = (res: any) => {
        responded = true;
        if (responseCallback) responseCallback(res);
      };

      for (const listener of this.runtimeListeners) {
        const willRespondAsync = listener(
          message,
          { id: this.runtime.id, tab: this.activeTab },
          sendResponse
        );
        if (willRespondAsync) {
          return;
        }
      }
      if (!responded && responseCallback) {
        responseCallback(undefined);
      }
    },
    getURL: (path: string) => `chrome-extension://${this.runtime.id}/${path.replace(/^\//, '')}`
  };

  public tabs: any = {
    query: (
      queryInfo: chrome.tabs.QueryInfo,
      callback?: (result: chrome.tabs.Tab[]) => void
    ): Promise<chrome.tabs.Tab[]> => {
      const result = this.activeTab ? [this.activeTab] : [];
      if (callback) callback(result);
      return Promise.resolve(result);
    },
    sendMessage: (
      tabId: number,
      message: any,
      responseCallback?: (response: any) => void
    ): Promise<any> => {
      let responded = false;
      let finalResponse: any;

      const listeners = this.tabListeners.get(tabId) || this.runtimeListeners;
      const sendResponse = (res: any) => {
        responded = true;
        finalResponse = res;
        if (responseCallback) responseCallback(res);
      };

      for (const listener of listeners) {
        const asyncWait = listener(
          message,
          { id: this.runtime.id, tab: { ...this.activeTab, id: tabId } },
          sendResponse
        );
        if (asyncWait) break;
      }

      return Promise.resolve(finalResponse);
    },
    onActivated: {
      addListener: (listener: TabActivatedListener) => {
        this.tabActivatedListeners.add(listener);
      },
      removeListener: (listener: TabActivatedListener) => {
        this.tabActivatedListeners.delete(listener);
      }
    },
    onUpdated: {
      addListener: (listener: TabUpdatedListener) => {
        this.tabUpdatedListeners.add(listener);
      },
      removeListener: (listener: TabUpdatedListener) => {
        this.tabUpdatedListeners.delete(listener);
      }
    }
  };

  public triggerTabActivated(activeInfo: chrome.tabs.TabActiveInfo) {
    for (const listener of this.tabActivatedListeners) {
      listener(activeInfo);
    }
  }

  public triggerTabUpdated(tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) {
    for (const listener of this.tabUpdatedListeners) {
      listener(tabId, changeInfo, tab);
    }
  }

  public storage = {
    local: {
      get: (
        keys: string | string[] | Record<string, any> | null,
        callback?: (items: { [key: string]: any }) => void
      ): Promise<{ [key: string]: any }> => {
        let result: Record<string, any> = {};
        if (keys === null) {
          result = { ...this.localStorageData };
        } else if (typeof keys === 'string') {
          result[keys] = this.localStorageData[keys];
        } else if (Array.isArray(keys)) {
          keys.forEach((k) => {
            result[k] = this.localStorageData[k];
          });
        }
        if (callback) callback(result);
        return Promise.resolve(result);
      },
      set: (items: Record<string, any>, callback?: () => void): Promise<void> => {
        Object.assign(this.localStorageData, items);
        if (callback) callback();
        return Promise.resolve();
      },
      remove: (keys: string | string[], callback?: () => void): Promise<void> => {
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach((k) => delete this.localStorageData[k]);
        if (callback) callback();
        return Promise.resolve();
      },
      clear: (callback?: () => void): Promise<void> => {
        this.localStorageData = {};
        if (callback) callback();
        return Promise.resolve();
      }
    }
  };

  public sidePanel = {
    open: vi.fn().mockResolvedValue(undefined),
    setPanelBehavior: vi.fn().mockResolvedValue(undefined),
    setOptions: vi.fn().mockResolvedValue(undefined)
  };

  public downloads = {
    download: vi.fn().mockImplementation((options: chrome.downloads.DownloadOptions) => {
      return Promise.resolve(12345);
    })
  };

  public permissions = {
    contains: vi.fn().mockImplementation((details: chrome.permissions.Permissions) => {
      const perms = details.permissions || [];
      const hasAll = perms.every((p) => this.grantedPermissions.has(p));
      return Promise.resolve(hasAll);
    }),
    request: vi.fn().mockImplementation((details: chrome.permissions.Permissions) => {
      const perms = details.permissions || [];
      perms.forEach((p) => this.grantedPermissions.add(p));
      return Promise.resolve(true);
    }),
    remove: vi.fn().mockImplementation((details: chrome.permissions.Permissions) => {
      const perms = details.permissions || [];
      perms.forEach((p) => this.grantedPermissions.delete(p));
      return Promise.resolve(true);
    })
  };

  public scripting = {
    executeScript: vi.fn().mockResolvedValue([{ result: true }])
  };

  public reset() {
    this.runtimeListeners.clear();
    this.tabListeners.clear();
    this.tabActivatedListeners.clear();
    this.tabUpdatedListeners.clear();
    this.localStorageData = {};
    this.runtime.lastError = undefined;
    this.sidePanel.open.mockClear();
    this.sidePanel.setPanelBehavior.mockClear();
    this.sidePanel.setOptions.mockClear();
    this.downloads.download.mockClear();
    this.permissions.contains.mockClear();
    this.permissions.request.mockClear();
    this.permissions.remove.mockClear();
    this.scripting.executeScript.mockClear();
  }
}

export const createChromeMock = () => new ChromeMock();

import { vi } from 'vitest';

/**
 * High-fidelity Chrome Extension API Mock for Manifest V3 unit and integration testing.
 * Provides realistic message routing, storage, tab tracking, downloads, and event listeners.
 */

type MessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
) => boolean | void;

type TabActivatedListener = (activeInfo: chrome.tabs.TabActiveInfo) => void;
type TabUpdatedListener = (
  tabId: number,
  changeInfo: chrome.tabs.TabChangeInfo,
  tab: chrome.tabs.Tab
) => void;

/** Enough of Chrome's match-pattern rules for `tabs.query({ url })` in tests. */
function matchUrlPattern(pattern: string, url: string): boolean {
  if (pattern === '<all_urls>') return true;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(url);
}

export class ChromeMock {
  private runtimeListeners: Set<MessageListener> = new Set();
  private tabListeners: Map<number, Set<MessageListener>> = new Map();
  private tabActivatedListeners: Set<TabActivatedListener> = new Set();
  private tabUpdatedListeners: Set<TabUpdatedListener> = new Set();
  private tabRemovedListeners: Set<(tabId: number) => void> = new Set();
  private localStorageData: Record<string, unknown> = {};
  private sessionStorageData: Record<string, unknown> = {};
  /** Tabs this mock has created, in addition to the fixture `activeTab`. */
  public openTabs: Map<number, chrome.tabs.Tab> = new Map();
  private nextTabId = 1000;
  public grantedPermissions: Set<string> = new Set(['activeTab', 'sidePanel', 'storage', 'scripting', 'downloads']);
  // Optional host grants default to allowed (tests opt into revocation via
  // request/remove). contains() returns true for every origin except revoked.
  public grantedOrigins: Set<string> = new Set(['http://localhost:3000/*', 'http://127.0.0.1:3456/*', 'https://example.com/*', 'https://shop.test/*', 'http://shop.test/*']);
  public revokedOrigins: Set<string> = new Set();

  public activeTab: chrome.tabs.Tab = {
    id: 101,
    index: 0,
    windowId: 1,
    highlighted: true,
    active: true,
    pinned: false,
    incognito: false,
    frozen: false,
    selected: true,
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
    url: 'http://127.0.0.1:3456/simple-grid.html',
    title: 'Simple Product Grid'
  } as chrome.tabs.Tab;

  public runtime = {
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
    sendMessage: (message: unknown, responseCallback?: (response: unknown) => void) => {
      let responded = false;
      const sendResponse = (res: unknown) => {
        responded = true;
        if (responseCallback) responseCallback(res);
      };

      for (const listener of this.runtimeListeners) {
        const willRespondAsync = listener(
          message,
          // A side panel page: an extension URL, and no tab of its own.
          { id: this.runtime.id, url: `chrome-extension://${this.runtime.id}/sidepanel.html` },
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
    getURL: (path: string) => `chrome-extension://${this.runtime.id}/${path.replace(/^\//, '')}`,
    getManifest: () => ({ manifest_version: 3, name: 'PageHarvest', version: '1.0.0' })
  };

  public tabs = {
    query: (
      queryInfo: chrome.tabs.QueryInfo,
      callback?: (result: chrome.tabs.Tab[]) => void
    ): Promise<chrome.tabs.Tab[]> => {
      const all = [this.activeTab, ...this.openTabs.values()].filter(Boolean);
      let result = all;
      if (queryInfo?.url) {
        const patterns = Array.isArray(queryInfo.url) ? queryInfo.url : [queryInfo.url];
        result = all.filter((tab) => typeof tab.url === 'string' && patterns.some((pattern) => matchUrlPattern(pattern, tab.url as string)));
      }
      if (queryInfo?.active) result = result.filter((tab) => tab.active);
      if (queryInfo?.currentWindow) result = result.filter((tab) => tab.windowId === this.activeTab.windowId);
      if (callback) callback(result);
      return Promise.resolve(result);
    },
    create: (
      createProperties: chrome.tabs.CreateProperties,
      callback?: (tab: chrome.tabs.Tab) => void
    ): Promise<chrome.tabs.Tab> => {
      const id = this.nextTabId++;
      const tab = {
        ...this.activeTab,
        id,
        index: this.openTabs.size + 1,
        active: createProperties.active ?? true,
        status: 'complete',
        url: createProperties.url ?? 'about:blank',
        title: createProperties.url ?? 'about:blank',
      } as chrome.tabs.Tab;
      this.openTabs.set(id, tab);
      if (callback) callback(tab);
      return Promise.resolve(tab);
    },
    get: (
      tabId: number,
      callback?: (tab: chrome.tabs.Tab) => void
    ): Promise<chrome.tabs.Tab> => {
      const tab = tabId === this.activeTab.id ? this.activeTab : this.openTabs.get(tabId);
      if (!tab) return Promise.reject(new Error(`No tab with id: ${tabId}.`));
      if (callback) callback(tab);
      return Promise.resolve(tab);
    },
    update: (
      tabId: number,
      updateProperties: chrome.tabs.UpdateProperties,
      callback?: (tab: chrome.tabs.Tab) => void
    ): Promise<chrome.tabs.Tab> => {
      const existing = tabId === this.activeTab.id ? this.activeTab : this.openTabs.get(tabId);
      if (!existing) return Promise.reject(new Error(`No tab with id: ${tabId}.`));
      const updated = {
        ...existing,
        ...(updateProperties.url !== undefined ? { url: updateProperties.url, status: 'complete' } : {}),
        ...(updateProperties.active !== undefined ? { active: updateProperties.active } : {}),
      } as chrome.tabs.Tab;
      if (tabId === this.activeTab.id) this.activeTab = updated;
      else this.openTabs.set(tabId, updated);
      if (callback) callback(updated);
      return Promise.resolve(updated);
    },
    remove: (tabIds: number | number[], callback?: () => void): Promise<void> => {
      const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
      for (const id of ids) this.openTabs.delete(id);
      for (const id of ids) {
        for (const listener of this.tabRemovedListeners) listener(id);
      }
      if (callback) callback();
      return Promise.resolve();
    },
    sendMessage: (
      tabId: number,
      message: unknown,
      responseCallback?: (response: unknown) => void
    ): Promise<unknown> => {
      let finalResponse: unknown;

      const listeners = this.tabListeners.get(tabId) || this.runtimeListeners;
      const sendResponse = (res: unknown) => {
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
    },
    onRemoved: {
      addListener: (listener: (tabId: number) => void) => {
        this.tabRemovedListeners.add(listener);
      },
      removeListener: (listener: (tabId: number) => void) => {
        this.tabRemovedListeners.delete(listener);
      }
    }
  };

  public triggerTabRemoved(tabId: number) {
    for (const listener of this.tabRemovedListeners) {
      listener(tabId);
    }
  }

  /** Delivers a runtime message as a content script in this tab would send it. */
  public sendFromContentScript(tabId: number, message: unknown): Promise<unknown> {
    return new Promise((resolve) => {
      let answered = false;
      for (const listener of this.runtimeListeners) {
        const willRespondAsync = listener(
          message,
          { id: this.runtime.id, tab: { ...this.activeTab, id: tabId } },
          (response) => {
            answered = true;
            resolve(response);
          }
        );
        if (willRespondAsync) return;
      }
      if (!answered) resolve(undefined);
    });
  }

  /**
   * Delivers a one-way message from a content script to every extension listener, as Chrome
   * does: the background and an open side panel both receive it, whichever answers first.
   */
  public notifyFromContentScript(tabId: number, message: unknown): void {
    for (const listener of [...this.runtimeListeners]) {
      listener(message, { id: this.runtime.id, tab: { ...this.activeTab, id: tabId } }, () => undefined);
    }
  }

  /** Routes tab messages for one tab to a listener, as a content script there would. */
  public setTabListener(tabId: number, listener: MessageListener) {
    this.tabListeners.set(tabId, new Set([listener]));
  }

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
        keys: string | string[] | Record<string, unknown> | null,
        callback?: (items: { [key: string]: unknown }) => void
      ): Promise<{ [key: string]: unknown }> => {
        let result: Record<string, unknown> = {};
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
      set: (items: Record<string, unknown>, callback?: () => void): Promise<void> => {
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
    },
    session: {
      get: (
        keys: string | string[] | Record<string, unknown> | null,
        callback?: (items: { [key: string]: unknown }) => void
      ): Promise<{ [key: string]: unknown }> => {
        let result: Record<string, unknown> = {};
        if (keys === null) {
          result = { ...this.sessionStorageData };
        } else if (typeof keys === 'string') {
          result[keys] = this.sessionStorageData[keys];
        } else if (Array.isArray(keys)) {
          keys.forEach((k) => {
            result[k] = this.sessionStorageData[k];
          });
        } else {
          Object.keys(keys).forEach((k) => {
            result[k] = this.sessionStorageData[k] ?? keys[k];
          });
        }
        if (callback) callback(result);
        return Promise.resolve(result);
      },
      set: (items: Record<string, unknown>, callback?: () => void): Promise<void> => {
        Object.assign(this.sessionStorageData, items);
        if (callback) callback();
        return Promise.resolve();
      },
      remove: (keys: string | string[], callback?: () => void): Promise<void> => {
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach((k) => delete this.sessionStorageData[k]);
        if (callback) callback();
        return Promise.resolve();
      },
      clear: (callback?: () => void): Promise<void> => {
        this.sessionStorageData = {};
        if (callback) callback();
        return Promise.resolve();
      }
    }
  };

  public windows = {
    update: vi.fn(
      (_windowId: number, _updateInfo: chrome.windows.UpdateInfo) => Promise.resolve({} as chrome.windows.Window)
    )
  };

  public sidePanel = {
    open: vi.fn().mockResolvedValue(undefined),
    setPanelBehavior: vi.fn().mockResolvedValue(undefined),
    setOptions: vi.fn().mockResolvedValue(undefined)
  };

  /** What chrome.downloads.search reports for each download id. Tests set an entry to change it. */
  public downloadItems: Map<number, Partial<chrome.downloads.DownloadItem>> = new Map();

  public downloads = {
    download: vi.fn((options: chrome.downloads.DownloadOptions) => {
      const id = 12345;
      // Chrome saves into the user's Downloads folder and finishes a small file at once.
      if (!this.downloadItems.has(id)) {
        this.downloadItems.set(id, {
          id,
          state: 'complete',
          filename: `C:\\Users\\someone\\Downloads\\${options.filename ?? 'download'}`,
        });
      }
      return Promise.resolve(id);
    }),
    search: vi.fn((query: chrome.downloads.DownloadQuery) => {
      const items = [...this.downloadItems.values()].filter((item) => query.id === undefined || item.id === query.id);
      return Promise.resolve(items as chrome.downloads.DownloadItem[]);
    }),
    show: vi.fn((_downloadId: number) => undefined)
  };

  // Implementations are passed to vi.fn(impl), not set with mockImplementation, so that
  // vi.restoreAllMocks() in a test file restores them instead of leaving undefined.
  // Host grants default-allow (any origin not explicitly revoked via revokedOrigins),
  // so fixture origins used by existing tests need no pre-listing.
  public permissions = {
    contains: vi.fn((details: chrome.permissions.Permissions) => {
      const perms = details.permissions || [];
      const origins = details.origins || [];
      const hasPerms = perms.every((p) => this.grantedPermissions.has(p));
      const hasOrigins = origins.every((o) => !this.revokedOrigins.has(o));
      return Promise.resolve(hasPerms && hasOrigins);
    }),
    request: vi.fn((details: chrome.permissions.Permissions) => {
      const perms = details.permissions || [];
      const origins = details.origins || [];
      perms.forEach((p) => this.grantedPermissions.add(p));
      origins.forEach((o) => { this.grantedOrigins.add(o); this.revokedOrigins.delete(o); });
      return Promise.resolve(true);
    }),
    remove: vi.fn((details: chrome.permissions.Permissions) => {
      const perms = details.permissions || [];
      const origins = details.origins || [];
      perms.forEach((p) => this.grantedPermissions.delete(p));
      origins.forEach((o) => { this.grantedOrigins.delete(o); this.revokedOrigins.add(o); });
      return Promise.resolve(true);
    }),
    onRemoved: {
      listeners: new Set<(permissions: chrome.permissions.Permissions) => void>(),
      addListener: function (this: { listeners: Set<(p: chrome.permissions.Permissions) => void> }, listener: (p: chrome.permissions.Permissions) => void) {
        this.listeners.add(listener);
      },
      removeListener: function (this: { listeners: Set<(p: chrome.permissions.Permissions) => void> }, listener: (p: chrome.permissions.Permissions) => void) {
        this.listeners.delete(listener);
      },
    },
  };

  public scripting = {
    executeScript: vi.fn((_injection: chrome.scripting.ScriptInjection<unknown[], unknown>) => Promise.resolve([{ result: true as unknown }]))
  };

  public reset() {
    this.runtimeListeners.clear();
    this.tabListeners.clear();
    this.tabActivatedListeners.clear();
    this.tabUpdatedListeners.clear();
    this.tabRemovedListeners.clear();
    this.localStorageData = {};
    this.sessionStorageData = {};
    this.openTabs.clear();
    this.nextTabId = 1000;
    this.activeTab = {
      ...this.activeTab,
      url: 'http://127.0.0.1:3456/simple-grid.html',
      title: 'Simple Product Grid',
      active: true,
      status: undefined,
    } as chrome.tabs.Tab;
    this.runtime.lastError = undefined;
    this.sidePanel.open.mockClear();
    this.sidePanel.setPanelBehavior.mockClear();
    this.sidePanel.setOptions.mockClear();
    this.downloads.download.mockClear();
    this.downloads.search.mockClear();
    this.downloads.show.mockClear();
    this.downloadItems.clear();
    this.permissions.contains.mockClear();
    this.permissions.request.mockClear();
    this.permissions.remove.mockClear();
    this.scripting.executeScript.mockClear();
    this.windows.update.mockClear();
    this.grantedOrigins = new Set([
      'http://localhost:3000/*',
      'http://127.0.0.1:3456/*',
      'https://example.com/*',
      'https://shop.test/*',
      'http://shop.test/*',
    ]);
    this.revokedOrigins.clear();
  }

  public triggerPermissionsRemoved(permissions: chrome.permissions.Permissions) {
    for (const listener of this.permissions.onRemoved.listeners) listener(permissions);
  }
}

export const createChromeMock = () => new ChromeMock();

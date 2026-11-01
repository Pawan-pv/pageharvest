import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createChromeMock, ChromeMock } from '../utils/chrome-mock';
import {
  getActiveTab,
  isHarvestableUrl,
  getTabStatus,
  TabManager
} from '@/platform/tab-manager';

describe('Tab Lifecycle & Active Tab Detection', () => {
  let mockChrome: ChromeMock;

  beforeEach(() => {
    mockChrome = createChromeMock();
    Reflect.set(globalThis, 'chrome', mockChrome);
  });

  describe('isHarvestableUrl', () => {
    it('accepts standard http and https URLs', () => {
      expect(isHarvestableUrl('https://example.com/products')).toBe(true);
      expect(isHarvestableUrl('http://localhost:3000')).toBe(true);
      expect(isHarvestableUrl('http://127.0.0.1:8080/shop')).toBe(true);
    });

    it('rejects browser internal pages and extension urls', () => {
      expect(isHarvestableUrl('chrome://settings')).toBe(false);
      expect(isHarvestableUrl('chrome://extensions')).toBe(false);
      expect(isHarvestableUrl('chrome-extension://abcdefghijklmnop/options.html')).toBe(false);
      expect(isHarvestableUrl('devtools://devtools/bundled/inspector.html')).toBe(false);
      expect(isHarvestableUrl('edge://settings')).toBe(false);
      expect(isHarvestableUrl('about:blank')).toBe(false);
      expect(isHarvestableUrl('view-source:https://example.com')).toBe(false);
    });

    it('rejects Chrome Web Store pages where extensions cannot run', () => {
      expect(isHarvestableUrl('https://chromewebstore.google.com/detail/xyz')).toBe(false);
      expect(isHarvestableUrl('https://chrome.google.com/webstore/detail/xyz')).toBe(false);
    });

    it('rejects undefined or empty URLs', () => {
      expect(isHarvestableUrl(undefined)).toBe(false);
      expect(isHarvestableUrl('')).toBe(false);
    });
  });

  describe('getActiveTab', () => {
    it('returns the active tab from the current window', async () => {
      mockChrome.activeTab = {
        id: 42,
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
        url: 'https://news.ycombinator.com',
        title: 'Hacker News'
      };

      const tab = await getActiveTab();
      expect(tab).toBeDefined();
      expect(tab?.id).toBe(42);
      expect(tab?.title).toBe('Hacker News');
    });

    it('returns null when no active tab exists', async () => {
      mockChrome.tabs.query = vi.fn().mockResolvedValue([]);
      const tab = await getActiveTab();
      expect(tab).toBeNull();
    });
  });

  describe('getTabStatus', () => {
    it('reports ready status for standard harvestable web page', () => {
      const tab: chrome.tabs.Tab = {
        id: 10,
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
        status: 'complete',
        url: 'https://books.toscrape.com',
        title: 'Books to Scrape'
      };

      const status = getTabStatus(tab);
      expect(status.isHarvestable).toBe(true);
      expect(status.status).toBe('ready');
      expect(status.url).toBe('https://books.toscrape.com');
    });

    it('reports unsupported for restricted chrome:// URL', () => {
      const tab: chrome.tabs.Tab = {
        id: 11,
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
        status: 'complete',
        url: 'chrome://history',
        title: 'History'
      };

      const status = getTabStatus(tab);
      expect(status.isHarvestable).toBe(false);
      expect(status.status).toBe('unsupported');
      expect(status.reason).toContain('restricted');
    });

    it('reports loading status when tab is still loading', () => {
      const tab: chrome.tabs.Tab = {
        id: 12,
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
        status: 'loading',
        url: 'https://example.com',
        title: 'Loading...'
      };

      const status = getTabStatus(tab);
      expect(status.isHarvestable).toBe(true);
      expect(status.status).toBe('loading');
    });
  });

  describe('TabManager Lifecycle Events', () => {
    it('notifies listeners when active tab changes via onActivated', async () => {
      const manager = new TabManager();
      const listener = vi.fn();
      manager.subscribe(listener);

      mockChrome.activeTab = {
        id: 202,
        index: 1,
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
        status: 'complete',
        url: 'https://en.wikipedia.org',
        title: 'Wikipedia'
      };

      mockChrome.triggerTabActivated({ tabId: 202, windowId: 1 });
      await new Promise((r) => setTimeout(r, 20));

      expect(listener).toHaveBeenCalled();
      const lastStatus = listener.mock.calls[0][0];
      expect(lastStatus.tabId).toBe(202);
      expect(lastStatus.url).toBe('https://en.wikipedia.org');
    });

    it('notifies listeners when tab finishes loading via onUpdated', async () => {
      const manager = new TabManager();
      const listener = vi.fn();
      manager.subscribe(listener);

      const updatedTab: chrome.tabs.Tab = {
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
        status: 'complete',
        url: 'https://example.com/done',
        title: 'Done'
      };

      mockChrome.triggerTabUpdated(101, { status: 'complete' }, updatedTab);
      await new Promise((r) => setTimeout(r, 20));

      expect(listener).toHaveBeenCalled();
      const lastStatus = listener.mock.calls[0][0];
      expect(lastStatus.status).toBe('ready');
      expect(lastStatus.url).toBe('https://example.com/done');
    });
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { messagingService } from '@/services/messaging';

describe('extension messaging service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports when Chrome has no active tab instead of inventing page metadata', async () => {
    const originalQuery = chrome.tabs.query;
    chrome.tabs.query = vi.fn().mockResolvedValue([]);

    await expect(messagingService.getActiveTab()).rejects.toThrow(/active tab/i);

    chrome.tabs.query = originalQuery;
  });

  it('recovers redacted active-tab metadata from the loaded content script', async () => {
    const query = vi.spyOn(chrome.tabs, 'query').mockResolvedValue([{
      id: 42,
      title: '',
      url: undefined,
    } as chrome.tabs.Tab]);
    const sendMessage = vi.spyOn(chrome.tabs, 'sendMessage').mockResolvedValue({
      id: 'pong_1',
      type: 'PONG',
      timestamp: Date.now(),
      payload: {
        status: 'OK',
        url: 'http://127.0.0.1:3456/twenty-cards.html',
        title: '20 Product Listing - PageHarvest Fixture',
      },
    });

    const tab = await messagingService.getActiveTab();

    expect(query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(sendMessage).toHaveBeenCalledWith(42, expect.objectContaining({ type: 'PING' }));
    expect(tab).toMatchObject({
      id: 42,
      url: 'http://127.0.0.1:3456/twenty-cards.html',
      title: '20 Product Listing - PageHarvest Fixture',
      isInjectable: true,
    });
  });

  it('marks a tab whose address Chrome hides as needing access, not as a browser page', async () => {
    vi.spyOn(chrome.tabs, 'query').mockResolvedValue([{ id: 43, title: '', url: undefined } as chrome.tabs.Tab]);
    vi.spyOn(chrome.tabs, 'sendMessage').mockRejectedValue(new Error('Receiving end does not exist.'));

    const tab = await messagingService.getActiveTab();

    expect(tab).toMatchObject({ id: 43, url: '', isInjectable: false, needsAccess: true });
  });

  it('does not ask for access on a tab whose address Chrome shows', async () => {
    vi.spyOn(chrome.tabs, 'query').mockResolvedValue([
      { id: 44, title: 'Shop', url: 'https://shop.test/items' } as chrome.tabs.Tab,
    ]);

    expect(await messagingService.getActiveTab()).toMatchObject({ isInjectable: true, needsAccess: false });
  });
});

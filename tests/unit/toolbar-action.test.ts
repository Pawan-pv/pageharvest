import { describe, expect, it, vi } from 'vitest';
import { registerToolbarAction, type ToolbarChrome } from '@/background/toolbar-action';

function fakeChrome() {
  let clicked: ((tab: chrome.tabs.Tab) => void) | undefined;
  const api = {
    action: {
      onClicked: {
        addListener: vi.fn((listener: (tab: chrome.tabs.Tab) => void) => {
          clicked = listener;
        }),
      },
    },
    sidePanel: {
      setPanelBehavior: vi.fn(() => Promise.resolve()),
      open: vi.fn((_options: chrome.sidePanel.OpenOptions) => Promise.resolve()),
    },
  };
  return { api, click: (tab: Partial<chrome.tabs.Tab>) => clicked?.(tab as chrome.tabs.Tab) };
}

describe('Toolbar button (ADR-037)', () => {
  it('lets the background handle the click, which is what grants activeTab for the page', () => {
    const { api } = fakeChrome();
    registerToolbarAction(api as unknown as ToolbarChrome);

    // Chrome's own open-on-click does not grant activeTab, so the panel could not see the page.
    expect(api.sidePanel.setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: false });
    expect(api.action.onClicked.addListener).toHaveBeenCalledTimes(1);
  });

  it('opens the side panel in the window of the clicked tab, synchronously inside the click', () => {
    const { api, click } = fakeChrome();
    registerToolbarAction(api as unknown as ToolbarChrome);

    click({ id: 7, windowId: 3, url: 'https://shop.test/items' });

    expect(api.sidePanel.open).toHaveBeenCalledWith({ windowId: 3 });
  });

  it('reports a failed open instead of throwing out of the click', async () => {
    const { api, click } = fakeChrome();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    api.sidePanel.open.mockReturnValueOnce(Promise.reject(new Error('No active side panel')));
    registerToolbarAction(api as unknown as ToolbarChrome);

    expect(() => click({ id: 7, windowId: 3 })).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalledWith('PageHarvest could not open the side panel:', expect.any(Error));
    warn.mockRestore();
  });

  it('does nothing without the side panel or action APIs', () => {
    expect(() => registerToolbarAction({} as ToolbarChrome)).not.toThrow();
  });
});

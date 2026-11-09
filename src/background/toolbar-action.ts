/**
 * The toolbar button opens the side panel from the background (ADR-037).
 *
 * With `openPanelOnActionClick: true` Chrome opens the panel itself, and that click does
 * not grant `activeTab`: the panel cannot see the page's address, so it shows "Access
 * needed" and cannot inject the content script. Handling `action.onClicked` here is the
 * documented way to invoke the action, which grants `activeTab` for the clicked tab, and
 * `sidePanel.open` is allowed because it runs inside that click.
 */
export interface ToolbarChrome {
  action?: {
    onClicked?: { addListener(listener: (tab: chrome.tabs.Tab) => void): void };
  };
  sidePanel?: {
    setPanelBehavior?(behavior: chrome.sidePanel.PanelBehavior): Promise<void>;
    open?(options: chrome.sidePanel.OpenOptions): Promise<void>;
  };
}

export function registerToolbarAction(api: ToolbarChrome = chrome): void {
  const sidePanel = api.sidePanel;
  const onClicked = api.action?.onClicked;
  if (!sidePanel?.open || !onClicked) return;

  // The behaviour is stored by Chrome, so an earlier version's `true` must be turned off.
  sidePanel.setPanelBehavior?.({ openPanelOnActionClick: false }).catch((err: unknown) => {
    console.warn('Could not set side panel behavior:', err);
  });

  onClicked.addListener((tab) => {
    if (tab.windowId === undefined) return;
    // No await before open(): it must run while Chrome still counts the click.
    sidePanel.open?.({ windowId: tab.windowId }).catch((err: unknown) => {
      console.warn('PageHarvest could not open the side panel:', err);
    });
  });
}

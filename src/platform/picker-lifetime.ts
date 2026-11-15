/**
 * Ties the page's element picker to the side panel that started it.
 *
 * While the user picks, the panel holds a port open to the page. Chrome closes that port
 * when the panel closes or reloads, and the page then stops the picker and removes its
 * overlay. Without this, a picker left behind would keep swallowing the page's clicks
 * until the user pressed Escape.
 */
export const PICKER_PORT_NAME = 'pageharvest-picker';

/** Panel side. Returns the function that lets go; calling it again does nothing. */
export function holdPickerOpen(tabId: number): () => void {
  const connect = typeof chrome !== 'undefined' ? chrome.tabs?.connect : undefined;
  if (typeof connect !== 'function') return () => undefined;
  let port: chrome.runtime.Port | null;
  try {
    port = connect(tabId, { name: PICKER_PORT_NAME });
  } catch {
    return () => undefined;
  }
  return () => {
    const held = port;
    port = null;
    try {
      held?.disconnect();
    } catch {
      // The page is already gone.
    }
  };
}

interface ConnectSource {
  onConnect: { addListener(listener: (port: chrome.runtime.Port) => void): void };
}

/**
 * Page side. Calls `stop` when the panel holding the current picker goes away. A newer
 * hold replaces an older one, so an older panel connection ending late cannot stop a
 * picker the user has just started again.
 */
export function stopPickerWhenPanelGoes(
  stop: () => void,
  runtime: ConnectSource | undefined = typeof chrome !== 'undefined' ? chrome.runtime : undefined
): void {
  if (!runtime?.onConnect) return;
  let current: chrome.runtime.Port | null = null;
  runtime.onConnect.addListener((port) => {
    if (port.name !== PICKER_PORT_NAME) return;
    current = port;
    port.onDisconnect.addListener(() => {
      if (current !== port) return;
      current = null;
      stop();
    });
  });
}

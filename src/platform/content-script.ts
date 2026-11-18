/**
 * On-demand content-script injection (ADR-037). The manifest declares no content
 * scripts; the panel and the background inject `content-scripts/content.js` with
 * chrome.scripting when a site grant (or the activeTab grant) allows it.
 */
export const CONTENT_SCRIPT_FILE = 'content-scripts/content.js';

/** Set by entrypoints/content.ts in the extension's isolated world of each document. */
export const INJECTED_FLAG = '__PAGEHARVEST_INJECTED__';

export interface InjectionResult {
  /** True when this call started the script in a document that had none. */
  injected: boolean;
  /** The document's address, read in the page. Empty when Chrome returned nothing. */
  url: string;
}

interface DocumentState {
  present: boolean;
  url: string;
}

/**
 * Makes sure the tab's current document runs the content script. A document that
 * already has it is left alone, so calling this again for the same document is safe
 * and reports `injected: false`. Throws when Chrome refuses to script the tab (no
 * grant for its site, a restricted page, or a closed tab).
 */
export async function injectContentScript(tabId: number): Promise<InjectionResult> {
  // `func` runs in the isolated world, the one the content script sets its flag in.
  const [probe] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (flag: string): DocumentState => ({
      present: (window as unknown as Record<string, unknown>)[flag] === true,
      url: window.location.href,
    }),
    args: [INJECTED_FLAG],
  });
  const state = probe?.result as Partial<DocumentState> | undefined;
  const url = typeof state?.url === 'string' ? state.url : '';
  if (state?.present === true) {
    return { injected: false, url };
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT_FILE] });
  return { injected: true, url };
}

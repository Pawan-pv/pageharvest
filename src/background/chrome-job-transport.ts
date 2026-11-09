import { ExtensionMessage } from '@/contracts/messages';
import { injectContentScript } from '@/platform/content-script';
import { MessagingClient } from '@/platform/messaging-client';
import { JobTransport } from './job-coordinator';

const TAB_MESSAGE_TIMEOUT_MS = 10_000;
const BROADCAST_TIMEOUT_MS = 2_000;

/**
 * The coordinator's connection to Chrome. Messages go through the validated
 * MessagingClient; tab operations need no permission beyond the manifest's.
 */
export function createChromeJobTransport(
  client: MessagingClient = new MessagingClient()
): JobTransport {
  return {
    sendToTab: (tabId, message: ExtensionMessage) =>
      client.sendToTab<unknown>(tabId, message, { timeoutMs: TAB_MESSAGE_TIMEOUT_MS }),

    // On-demand injection (ADR-037). Reports whether this document is new to the script.
    injectContentScript: (tabId: number) => injectContentScript(tabId),

    broadcast: async (message: ExtensionMessage) => {
      // With no side panel open there is no receiver, which is not an error.
      await client
        .sendToBackground<unknown>(message, { timeoutMs: BROADCAST_TIMEOUT_MS })
        .catch(() => undefined);
    },

    openBlankTab: async () => {
      const tab = await chrome.tabs.create({ url: 'about:blank', active: true });
      if (typeof tab.id !== 'number') {
        throw new Error('Chrome did not return a tab ID.');
      }
      return tab.id;
    },

    navigateTab: async (tabId, url) => {
      await chrome.tabs.update(tabId, { url });
    },

    getTabLoadStatus: async (tabId) => {
      try {
        const tab = await chrome.tabs.get(tabId);
        return tab.status ?? 'complete';
      } catch {
        return null;
      }
    },
  };
}

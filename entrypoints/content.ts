import { defineContentScript } from 'wxt/sandbox';
import { MessageRouter } from '@/platform/message-router';
import { ExtensionMessage } from '@/contracts/messages';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    // Prevent double injection in the same document
    if ((window as any).__PAGEHARVEST_INJECTED__) {
      return;
    }
    (window as any).__PAGEHARVEST_INJECTED__ = true;

    // Initialize content script message router
    const router = new MessageRouter();

    // 1. PING handler: acknowledges presence and returns page context
    router.on('PING', () => {
      const pongResponse: ExtensionMessage = {
        id: `pong_${Date.now()}`,
        type: 'PONG',
        timestamp: Date.now(),
        payload: {
          status: 'OK',
          url: window.location.href,
          title: document.title
        }
      };
      return pongResponse;
    });

    // 2. Picker lifecycle delegation hooks (Agent 3 will attach concrete overlays)
    router.on('START_PICKER', (msg) => {
      // Dispatches custom event for interactive picker module
      window.dispatchEvent(
        new CustomEvent('pageharvest:start-picker', { detail: msg.payload })
      );
      return {
        id: `resp_${Date.now()}`,
        type: 'PONG',
        timestamp: Date.now(),
        payload: { status: 'OK', url: window.location.href, title: 'Picker Activated' }
      };
    });

    router.on('STOP_PICKER', () => {
      window.dispatchEvent(new CustomEvent('pageharvest:stop-picker'));
      return {
        id: `resp_${Date.now()}`,
        type: 'PONG',
        timestamp: Date.now(),
        payload: { status: 'OK', url: window.location.href, title: 'Picker Deactivated' }
      };
    });

    router.listen();
  }
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createChromeMock, ChromeMock } from '../utils/chrome-mock';
import { MessageRouter } from '@/platform/message-router';
import { MessagingClient } from '@/platform/messaging-client';
import { ExtensionMessage } from '@/contracts/messages';

describe('Browser Messaging Infrastructure', () => {
  let mockChrome: ChromeMock;
  let router: MessageRouter;
  let client: MessagingClient;

  beforeEach(() => {
    mockChrome = createChromeMock();
    (globalThis as any).chrome = mockChrome;
    router = new MessageRouter();
    client = new MessagingClient();
  });

  describe('Message Routing', () => {
    it('routes a valid message to its registered handler and returns the response', async () => {
      router.on('PING', (msg) => {
        return {
          id: 'pong_1',
          type: 'PONG',
          timestamp: Date.now(),
          payload: {
            status: 'OK',
            url: 'https://example.com/items',
            title: 'Test Items'
          }
        };
      });
      router.listen();

      const pingMsg: ExtensionMessage = {
        id: 'ping_1',
        type: 'PING',
        timestamp: Date.now(),
        payload: { tabId: 101 }
      };

      const response = await client.sendToBackground(pingMsg);
      expect(response).toBeDefined();
      expect(response.type).toBe('PONG');
      if (response.type === 'PONG') {
        expect(response.payload.status).toBe('OK');
        expect(response.payload.url).toBe('https://example.com/items');
      }
    });

    it('handles asynchronous handlers returning Promises', async () => {
      router.on('DETECT_FIELDS', async (msg) => {
        await new Promise((r) => setTimeout(r, 10));
        return {
          id: 'resp_df',
          type: 'FIELDS_DETECTED',
          timestamp: Date.now(),
          payload: {
            containerSelector: '.item-card',
            suggestedFields: [
              { id: 'f1', name: 'title', selector: 'h2', extractor: 'text' }
            ]
          }
        };
      });
      router.listen();

      const request: ExtensionMessage = {
        id: 'df_1',
        type: 'DETECT_FIELDS',
        timestamp: Date.now(),
        payload: { containerSelector: '.item-card' }
      };

      const response = await client.sendToBackground(request);
      expect(response.type).toBe('FIELDS_DETECTED');
      if (response.type === 'FIELDS_DETECTED') {
        expect(response.payload.suggestedFields.length).toBe(1);
      }
    });
  });

  describe('Invalid Message Rejection', () => {
    it('rejects and fails when an invalid message structure is passed', async () => {
      router.listen();

      const malformedMessage = {
        id: 'bad_1',
        type: 'UNKNOWN_CUSTOM_TYPE',
        timestamp: 'invalid_timestamp'
      };

      await expect(client.sendToBackground(malformedMessage as any)).rejects.toThrow(
        /invalid message/i
      );
    });

    it('router responds with error response when received message violates schema', async () => {
      let responseReceived: any;
      router.listen();

      // Trigger directly on Chrome runtime onMessage listener
      mockChrome.runtime.sendMessage(
        { id: '', type: 'PING' }, // empty ID is invalid
        (res: any) => {
          responseReceived = res;
        }
      );

      expect(responseReceived).toBeDefined();
      expect(responseReceived.ok).toBe(false);
      expect(responseReceived.error).toContain('INVALID_MESSAGE');
    });
  });

  describe('Missing Tab Context', () => {
    it('throws when sending to active tab if no active tab exists', async () => {
      mockChrome.tabs.query = vi.fn().mockResolvedValue([]);

      const msg: ExtensionMessage = {
        id: 'ping_tab',
        type: 'PING',
        timestamp: Date.now()
      };

      await expect(client.sendToActiveTab(msg)).rejects.toThrow(
        /no active tab/i
      );
    });

    it('throws when sending to active tab if tab URL is restricted (chrome://)', async () => {
      mockChrome.tabs.query = vi.fn().mockResolvedValue([
        { id: 999, url: 'chrome://extensions', title: 'Extensions' }
      ]);

      const msg: ExtensionMessage = {
        id: 'ping_tab_chrome',
        type: 'PING',
        timestamp: Date.now()
      };

      await expect(client.sendToActiveTab(msg)).rejects.toThrow(
        /restricted/i
      );
    });
  });

  describe('Disconnected Receivers and Reconnection', () => {
    it('handles disconnected receiver error and attempts retry when configured', async () => {
      let callCount = 0;
      mockChrome.tabs.sendMessage = vi.fn().mockImplementation((tabId, msg, cb) => {
        callCount++;
        if (callCount === 1) {
          mockChrome.runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' };
          if (cb) cb(undefined);
          return Promise.resolve(undefined);
        }
        mockChrome.runtime.lastError = undefined;
        const res: ExtensionMessage = {
          id: 'pong_retry',
          type: 'PONG',
          timestamp: Date.now(),
          payload: { status: 'OK', url: 'https://example.com', title: 'Example' }
        };
        if (cb) cb(res);
        return Promise.resolve(res);
      });

      const msg: ExtensionMessage = {
        id: 'ping_reconnect',
        type: 'PING',
        timestamp: Date.now()
      };

      const result = await client.sendToTab(101, msg, { retries: 1, retryDelayMs: 10 });
      expect(callCount).toBe(2);
      expect(result.type).toBe('PONG');
    });

    it('throws DISCONNECTED_RECEIVER if all retries fail', async () => {
      mockChrome.tabs.sendMessage = vi.fn().mockImplementation((tabId, msg, cb) => {
        mockChrome.runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' };
        if (cb) cb(undefined);
        return Promise.resolve(undefined);
      });

      const msg: ExtensionMessage = {
        id: 'ping_fail',
        type: 'PING',
        timestamp: Date.now()
      };

      await expect(client.sendToTab(101, msg, { retries: 1, retryDelayMs: 5 })).rejects.toThrow(
        /receiving end does not exist/i
      );
    });
  });

  describe('Duplicate Requests & Cancellation', () => {
    it('deduplicates concurrent identical requests with the same message ID', async () => {
      let handlerExecutions = 0;
      router.on('PING', async () => {
        handlerExecutions++;
        await new Promise((r) => setTimeout(r, 30));
        return {
          id: 'pong_dedup',
          type: 'PONG',
          timestamp: Date.now(),
          payload: { status: 'OK', url: 'https://example.com' }
        };
      });
      router.listen();

      const msg: ExtensionMessage = {
        id: 'dup_msg_100',
        type: 'PING',
        timestamp: Date.now()
      };

      const [res1, res2] = await Promise.all([
        client.sendToBackground(msg),
        client.sendToBackground(msg)
      ]);

      expect(res1.type).toBe('PONG');
      expect(res2.type).toBe('PONG');
      expect(handlerExecutions).toBe(1);
    });

    it('cancels message wait when AbortSignal is aborted', async () => {
      router.on('PING', async () => {
        await new Promise((r) => setTimeout(r, 100));
        return {
          id: 'pong_late',
          type: 'PONG',
          timestamp: Date.now(),
          payload: { status: 'OK', url: 'https://example.com' }
        };
      });
      router.listen();

      const controller = new AbortController();
      const msg: ExtensionMessage = {
        id: 'abort_msg',
        type: 'PING',
        timestamp: Date.now()
      };

      const promise = client.sendToBackground(msg, { signal: controller.signal });
      controller.abort();

      await expect(promise).rejects.toThrow(/aborted|cancelled/i);
    });
  });

  describe('Unexpected Runtime Errors', () => {
    it('catches exceptions thrown in router handler and returns structured EXTRACTION_ERROR', async () => {
      router.on('EXTRACT_RECORDS', () => {
        throw new Error('Unexpected DOM corruption during harvest');
      });
      router.listen();

      mockChrome.runtime.sendMessage(
        {
          id: 'ext_err_1',
          type: 'EXTRACT_RECORDS',
          timestamp: Date.now(),
          payload: {
            recipe: {
              id: 'r1',
              name: 'Recipe',
              urlPattern: '.*',
              containerSelector: '.card',
              fields: [{ id: 'f1', name: 'title', selector: 'h1', extractor: 'text' }],
              createdAt: Date.now(),
              updatedAt: Date.now()
            },
            pageNumber: 1
          }
        },
        (res: any) => {
          expect(res).toBeDefined();
          expect(res.type).toBe('EXTRACTION_ERROR');
          expect(res.payload.message).toContain('Unexpected DOM corruption');
        }
      );
    });
  });
});

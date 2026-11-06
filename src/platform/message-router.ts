import { extensionMessageSchema, ExtensionMessage } from '@/contracts/messages';

export type MessageHandler<T extends ExtensionMessage = ExtensionMessage> = (
  message: T,
  sender: chrome.runtime.MessageSender
) => Promise<unknown> | unknown;

export class MessageRouter {
  private handlers: Map<string, MessageHandler> = new Map();
  private isListening: boolean = false;
  private boundListener:
    | ((
        rawMessage: unknown,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response?: unknown) => void
      ) => boolean)
    | null = null;

  public on<T extends ExtensionMessage['type']>(
    type: T,
    handler: MessageHandler<Extract<ExtensionMessage, { type: T }>>
  ): this {
    this.handlers.set(type, handler as MessageHandler);
    return this;
  }

  public off(type: string): this {
    this.handlers.delete(type);
    return this;
  }

  public listen(): void {
    if (this.isListening) return;

    this.boundListener = (
      rawMessage: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void
    ): boolean => {
      // Only this extension's own contexts are ever answered.
      if (
        typeof chrome !== 'undefined' &&
        chrome.runtime?.id &&
        sender?.id &&
        sender.id !== chrome.runtime.id
      ) {
        sendResponse({ ok: false, error: 'FOREIGN_SENDER: Message did not come from this extension' });
        return false;
      }

      // Validate incoming message structure
      const parseResult = extensionMessageSchema.safeParse(rawMessage);
      if (!parseResult.success) {
        sendResponse({
          ok: false,
          error: 'INVALID_MESSAGE: Message validation failed against ExtensionMessage schema',
          details: parseResult.error.errors
        });
        return false;
      }

      const message: ExtensionMessage = parseResult.data;
      const handler = this.handlers.get(message.type);

      if (!handler) {
        // No handler registered for this message type
        sendResponse({
          ok: false,
          error: `NO_HANDLER: No handler registered for message type "${message.type}"`
        });
        return false;
      }

      try {
        const result = handler(message, sender);

        if (result instanceof Promise) {
          result
            .then((res) => {
              sendResponse(res);
            })
            .catch((err: unknown) => {
              const errorMessage = err instanceof Error ? err.message : String(err);
              const errorResponse: ExtensionMessage = {
                id: `err_${Date.now()}`,
                type: 'EXTRACTION_ERROR',
                timestamp: Date.now(),
                payload: {
                  id: `err_${Date.now()}`,
                  category: 'UNKNOWN',
                  code: 'UNKNOWN_ERROR',
                  severity: 'ERROR',
                  message: errorMessage,
                  timestamp: Date.now(),
                  context: { originalMessageType: message.type }
                }
              };
              sendResponse(errorResponse);
            });
          return true; // Keep message channel open for async response
        } else {
          sendResponse(result);
          return false;
        }
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const errorResponse: ExtensionMessage = {
          id: `err_${Date.now()}`,
          type: 'EXTRACTION_ERROR',
          timestamp: Date.now(),
          payload: {
            id: `err_${Date.now()}`,
            category: 'UNKNOWN',
            code: 'UNKNOWN_ERROR',
            severity: 'ERROR',
            message: errorMessage,
            timestamp: Date.now(),
            context: { originalMessageType: message.type }
          }
        };
        sendResponse(errorResponse);
        return false;
      }
    };

    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(this.boundListener);
      this.isListening = true;
    }
  }

  public stop(): void {
    if (!this.isListening) return;
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage && this.boundListener) {
      chrome.runtime.onMessage.removeListener(this.boundListener);
    }
    this.isListening = false;
    this.boundListener = null;
  }
}

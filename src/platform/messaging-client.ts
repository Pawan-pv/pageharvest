import { extensionMessageSchema, ExtensionMessage } from '@/contracts/messages';
import { getActiveTab, isHarvestableUrl } from './tab-manager';

export interface SendOptions {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  signal?: AbortSignal;
}

/**
 * Chrome reports through the callback when one is passed. Some environments return a
 * promise instead, and a rejected promise must not go unobserved.
 */
function settleFromChrome<T>(
  returned: unknown,
  resolve: (value: T) => void,
  reject: (reason: unknown) => void
): void {
  if (returned && typeof (returned as PromiseLike<T>).then === 'function') {
    (returned as PromiseLike<T>).then(resolve, reject);
  }
}

export class MessagingClient {
  private inFlightRequests: Map<string, Promise<unknown>> = new Map();

  /**
   * Validate outbound message before transmission
   */
  private validateMessage(message: unknown): ExtensionMessage {
    const parseResult = extensionMessageSchema.safeParse(message);
    if (!parseResult.success) {
      throw new Error(
        `Invalid message: ${parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
      );
    }
    return parseResult.data;
  }

  /**
   * Send a message to the Background Service Worker
   */
  public async sendToBackground<T = ExtensionMessage>(
    message: ExtensionMessage,
    options: SendOptions = {}
  ): Promise<T> {
    const validated = this.validateMessage(message);

    // Deduplication check
    if (this.inFlightRequests.has(validated.id)) {
      return this.inFlightRequests.get(validated.id) as Promise<T>;
    }

    const requestPromise = this.executeSendWithRetry<T>(
      () =>
        new Promise<T>((resolve, reject) => {
          if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
            return reject(new Error('Chrome extension runtime is not available'));
          }

          settleFromChrome<T>(
            chrome.runtime.sendMessage(validated, (response) => {
              if (chrome.runtime.lastError) {
                return reject(new Error(chrome.runtime.lastError.message));
              }
              resolve(response);
            }) as unknown,
            resolve,
            reject
          );
        }),
      options
    ).finally(() => {
      this.inFlightRequests.delete(validated.id);
    });

    this.inFlightRequests.set(validated.id, requestPromise);
    return requestPromise;
  }

  /**
   * Send a message to a specific tab by ID
   */
  public async sendToTab<T = ExtensionMessage>(
    tabId: number,
    message: ExtensionMessage,
    options: SendOptions = {}
  ): Promise<T> {
    const validated = this.validateMessage(message);

    if (this.inFlightRequests.has(validated.id)) {
      return this.inFlightRequests.get(validated.id) as Promise<T>;
    }

    const requestPromise = this.executeSendWithRetry<T>(
      () =>
        new Promise<T>((resolve, reject) => {
          if (typeof chrome === 'undefined' || !chrome.tabs?.sendMessage) {
            return reject(new Error('Chrome extension tabs API is not available'));
          }

          settleFromChrome<T>(
            chrome.tabs.sendMessage(tabId, validated, (response) => {
              if (chrome.runtime.lastError) {
                return reject(new Error(chrome.runtime.lastError.message));
              }
              resolve(response);
            }) as unknown,
            resolve,
            reject
          );
        }),
      options
    ).finally(() => {
      this.inFlightRequests.delete(validated.id);
    });

    this.inFlightRequests.set(validated.id, requestPromise);
    return requestPromise;
  }

  /**
   * Send a message to the currently active tab in the current window
   */
  public async sendToActiveTab<T = ExtensionMessage>(
    message: ExtensionMessage,
    options: SendOptions = {}
  ): Promise<T> {
    const activeTab = await getActiveTab();
    if (!activeTab || typeof activeTab.id !== 'number') {
      throw new Error('No active tab found in the current window');
    }

    if (!isHarvestableUrl(activeTab.url)) {
      throw new Error(
        `Cannot harvest restricted URL "${activeTab.url || 'unknown'}". Extensions cannot run on internal or web store pages.`
      );
    }

    return this.sendToTab<T>(activeTab.id, message, options);
  }

  /**
   * Helper executing the send action with retries, timeout, and cancellation
   */
  private async executeSendWithRetry<T>(
    sendFn: () => Promise<T>,
    options: SendOptions
  ): Promise<T> {
    const {
      timeoutMs = 5000,
      retries = 0,
      retryDelayMs = 100,
      signal
    } = options;

    let attempts = 0;
    const maxAttempts = retries + 1;

    while (attempts < maxAttempts) {
      if (signal?.aborted) {
        throw new Error('Operation cancelled / aborted');
      }

      try {
        const result = await this.withTimeout(sendFn(), timeoutMs, signal);
        return result;
      } catch (err: unknown) {
        attempts++;
        const errorMessage = err instanceof Error ? err.message : String(err);

        // If aborted, do not retry
        if (signal?.aborted || errorMessage.includes('aborted') || errorMessage.includes('cancelled')) {
          throw new Error('Operation cancelled / aborted', { cause: err });
        }

        if (attempts >= maxAttempts) {
          throw err;
        }

        // Wait before retry
        await new Promise((r) => setTimeout(r, retryDelayMs * attempts));
      }
    }

    throw new Error('Max retries exceeded');
  }

  private withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;

      const abortHandler = () => {
        if (timer) clearTimeout(timer);
        reject(new Error('Operation cancelled / aborted'));
      };

      if (signal) {
        if (signal.aborted) {
          return reject(new Error('Operation cancelled / aborted'));
        }
        signal.addEventListener('abort', abortHandler, { once: true });
      }

      timer = setTimeout(() => {
        if (signal) signal.removeEventListener('abort', abortHandler);
        reject(new Error(`Message timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      promise
        .then((res) => {
          if (timer) clearTimeout(timer);
          if (signal) signal.removeEventListener('abort', abortHandler);
          resolve(res);
        })
        .catch((err) => {
          if (timer) clearTimeout(timer);
          if (signal) signal.removeEventListener('abort', abortHandler);
          reject(err);
        });
    });
  }
}

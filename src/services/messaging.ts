import {
  ExtensionMessage,
  extensionMessageSchema,
  startPickerMessageSchema,
  stopPickerMessageSchema,
  detectRepeatedElementsMessageSchema,
  detectFieldsMessageSchema,
  extractRecordsMessageSchema,
  executePaginationStepMessageSchema,
  executeScrollStepMessageSchema
} from '@/contracts/messages';
import { ExtractionRecipe, FieldDefinition } from '@/types';

function generateId(): string {
  return 'msg_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now();
}

export interface TabInfo {
  id?: number;
  url: string;
  title: string;
  favIconUrl?: string;
  isInjectable: boolean;
}

export type MessageListener = (message: ExtensionMessage) => void;

class ExtensionMessagingService {
  private listeners: Set<MessageListener> = new Set();
  private mockMode: boolean = false;

  constructor() {
    this.initRuntimeListener();
  }

  private initRuntimeListener() {
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((message: unknown) => {
        const parsed = extensionMessageSchema.safeParse(message);
        if (parsed.success) {
          this.notifyListeners(parsed.data);
        }
      });
    }
  }

  public setMockMode(enabled: boolean) {
    this.mockMode = enabled;
  }

  public subscribe(listener: MessageListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(message: ExtensionMessage) {
    this.listeners.forEach((listener) => {
      try {
        listener(message);
      } catch (err) {
        console.error('Error in message listener:', err);
      }
    });
  }

  /**
   * Dispatches a message locally to simulate an incoming message from content script (used in tests / dev).
   */
  public emitMessage(message: ExtensionMessage) {
    this.notifyListeners(message);
  }

  /**
   * Retrieves the current active tab and checks if PageHarvest can inspect it.
   */
  public async getActiveTab(): Promise<TabInfo> {
    if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs.length > 0 && tabs[0]) {
          const tab = tabs[0];
          const url = tab.url || '';
          const isInjectable =
            url.startsWith('http://') ||
            url.startsWith('https://') ||
            url.startsWith('file://');
          return {
            id: tab.id,
            url,
            title: tab.title || 'Untitled Page',
            favIconUrl: tab.favIconUrl,
            isInjectable,
          };
        }
      } catch (err) {
        console.warn('Could not query active tab via chrome.tabs:', err);
      }
    }

    // Fallback for tests / standalone environments
    return {
      id: 1,
      url: 'https://example.com/products',
      title: 'Example E-Commerce Store',
      favIconUrl: 'https://example.com/favicon.ico',
      isInjectable: true,
    };
  }

  /**
   * Sends a typed message to the content script of the active tab.
   */
  public async sendToActiveTab(message: ExtensionMessage): Promise<unknown> {
    const validated = extensionMessageSchema.parse(message);

    if (this.mockMode || typeof chrome === 'undefined' || !chrome.tabs?.sendMessage) {
      return { success: true };
    }

    const tab = await this.getActiveTab();
    if (!tab.id || !tab.isInjectable) {
      throw new Error(`Cannot communicate with tab ${tab.url}. Extraction is only available on web pages.`);
    }

    try {
      return await chrome.tabs.sendMessage(tab.id, validated);
    } catch (err) {
      // If content script is not yet injected or tab is restricted
      throw new Error(
        'Could not communicate with the page content script. Please refresh the page or ensure permissions are granted.'
      );
    }
  }

  public async startElementPicker(): Promise<void> {
    const msg = startPickerMessageSchema.parse({
      id: generateId(),
      timestamp: Date.now(),
      type: 'START_PICKER',
      payload: { highlightColor: '#16a34a' },
    });
    await this.sendToActiveTab(msg);
  }

  public async stopElementPicker(): Promise<void> {
    const msg = stopPickerMessageSchema.parse({
      id: generateId(),
      timestamp: Date.now(),
      type: 'STOP_PICKER',
      payload: {},
    });
    await this.sendToActiveTab(msg);
  }

  public async detectRepeatedElements(targetSelector?: string): Promise<void> {
    const msg = detectRepeatedElementsMessageSchema.parse({
      id: generateId(),
      timestamp: Date.now(),
      type: 'DETECT_REPEATED_ELEMENTS',
      payload: { targetSelector },
    });
    await this.sendToActiveTab(msg);
  }

  public async detectFields(containerSelector: string): Promise<void> {
    const msg = detectFieldsMessageSchema.parse({
      id: generateId(),
      timestamp: Date.now(),
      type: 'DETECT_FIELDS',
      payload: { containerSelector },
    });
    await this.sendToActiveTab(msg);
  }

  public async startExtraction(recipe: ExtractionRecipe, pageNumber: number = 1): Promise<void> {
    const msg = extractRecordsMessageSchema.parse({
      id: generateId(),
      timestamp: Date.now(),
      type: 'EXTRACT_RECORDS',
      payload: {
        recipe,
        pageNumber,
      },
    });
    await this.sendToActiveTab(msg);
  }

  public async executePaginationStep(nextButtonSelector: string, delayMs: number = 1000): Promise<void> {
    const msg = executePaginationStepMessageSchema.parse({
      id: generateId(),
      timestamp: Date.now(),
      type: 'EXECUTE_PAGINATION_STEP',
      payload: { nextButtonSelector, delayMs },
    });
    await this.sendToActiveTab(msg);
  }

  public async executeScrollStep(scrollDelayMs: number = 500): Promise<void> {
    const msg = executeScrollStepMessageSchema.parse({
      id: generateId(),
      timestamp: Date.now(),
      type: 'EXECUTE_SCROLL_STEP',
      payload: { scrollDelayMs },
    });
    await this.sendToActiveTab(msg);
  }
}

export const messagingService = new ExtensionMessagingService();

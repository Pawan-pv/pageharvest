/**
 * Picker Runtime Messaging Bridge
 * Connects the interactive picker to the extension runtime (Side Panel & Background).
 */

import { ElementPicker } from './picker';
import { SelectedElementInfo, HoverElementInfo } from './types';

export interface PickerMessengerOptions {
  onStart?: () => void;
  onStop?: () => void;
}

export class PickerMessenger {
  private picker: ElementPicker | null = null;
  private messageListener: ((message: unknown, sender: unknown, sendResponse: (r?: unknown) => void) => void) | null = null;
  private isListening = false;

  constructor(private options: PickerMessengerOptions = {}) {}

  /**
   * Initializes the message listener for START_PICKER and STOP_PICKER commands.
   */
  public init(): void {
    if (this.isListening) return;

    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      this.messageListener = (message: unknown, _sender: unknown, sendResponse: (r?: unknown) => void) => {
        if (!message || typeof message !== 'object') return;
        const msg = message as { type?: string; payload?: unknown };

        switch (msg.type) {
          case 'START_PICKER': {
            this.startPicker();
            sendResponse({ success: true, mode: 'inspecting' });
            break;
          }
          case 'STOP_PICKER': {
            this.stopPicker();
            sendResponse({ success: true, mode: 'inactive' });
            break;
          }
        }
      };

      chrome.runtime.onMessage.addListener(this.messageListener);
      this.isListening = true;
    }
  }

  /**
   * Starts the picker and binds outbound runtime notifications.
   */
  public startPicker(): void {
    if (this.picker) {
      this.picker.stop();
    }

    this.picker = new ElementPicker({
      onHover: (info) => this.sendHoverUpdate(info),
      onSelect: (info) => this.sendElementSelected(info),
      onConfirm: (info) => this.sendSelectionConfirmed(info),
      onCancel: () => this.sendSelectionCancelled()
    });

    this.picker.start();

    if (this.options.onStart) {
      this.options.onStart();
    }
  }

  /**
   * Stops the active picker.
   */
  public stopPicker(): void {
    if (this.picker) {
      this.picker.stop();
      this.picker = null;
    }

    if (this.options.onStop) {
      this.options.onStop();
    }
  }

  /**
   * Returns current active picker instance.
   */
  public getPicker(): ElementPicker | null {
    return this.picker;
  }

  /**
   * Removes all extension runtime message listeners and tears down picker.
   */
  public destroy(): void {
    this.stopPicker();

    if (this.isListening && this.messageListener && typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.removeListener(this.messageListener);
      this.messageListener = null;
      this.isListening = false;
    }
  }

  private sendHoverUpdate(info: HoverElementInfo | null): void {
    if (!info) return;
    this.safeSendMessage({
      type: 'ELEMENT_HOVERED',
      id: `hover_${Date.now()}`,
      timestamp: Date.now(),
      payload: {
        selector: info.selector,
        tagName: info.tagName,
        rect: info.rect
      }
    });
  }

  private sendElementSelected(info: SelectedElementInfo): void {
    this.safeSendMessage({
      type: 'ELEMENT_SELECTED',
      id: `sel_${Date.now()}`,
      timestamp: Date.now(),
      payload: {
        selector: info.selector,
        tagName: info.tagName,
        classList: info.classList,
        textSnippet: info.textSnippet,
        matchCount: info.matchCount,
        rect: info.rect
      }
    });
  }

  private sendSelectionConfirmed(info: SelectedElementInfo): void {
    this.safeSendMessage({
      type: 'SELECTION_CONFIRMED',
      id: `conf_${Date.now()}`,
      timestamp: Date.now(),
      payload: {
        selector: info.selector,
        tagName: info.tagName,
        matchCount: info.matchCount
      }
    });
  }

  private sendSelectionCancelled(): void {
    this.safeSendMessage({
      type: 'SELECTION_CANCELLED',
      id: `canc_${Date.now()}`,
      timestamp: Date.now(),
      payload: {}
    });
  }

  private safeSendMessage(msg: unknown): void {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      try {
        chrome.runtime.sendMessage(msg);
      } catch {
        // Context may be invalidated or receiver absent
      }
    }
  }
}

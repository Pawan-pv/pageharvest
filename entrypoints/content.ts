import { defineContentScript } from 'wxt/sandbox';
import { MessageRouter } from '@/platform/message-router';
import { MessagingClient } from '@/platform/messaging-client';
import { ExtensionMessage } from '@/contracts/messages';
import { PickerMessenger } from '@/content/picker';
import { createContentWorkflowCoordinator, DetectionError } from '@/content/workflow-coordinator';
import { errorReporter } from '@/core/resilience/error-reporter';

interface PageHarvestWindow extends Window {
  __PAGEHARVEST_INJECTED__?: boolean;
}

type DetectRepeatedElementsMessage = Extract<
  ExtensionMessage,
  { type: 'DETECT_REPEATED_ELEMENTS' }
>;
type DetectFieldsMessage = Extract<ExtensionMessage, { type: 'DETECT_FIELDS' }>;
type ExtractRecordsMessage = Extract<ExtensionMessage, { type: 'EXTRACT_RECORDS' }>;
type ControlJobMessage = Extract<ExtensionMessage, { type: 'CONTROL_JOB' }>;
type PreviewFieldsMessage = Extract<ExtensionMessage, { type: 'PREVIEW_FIELDS' }>;

const BATCH_DELIVERY_TIMEOUT_MS = 30_000;

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    // Prevent double injection in the same document
    const pageWindow = window as PageHarvestWindow;
    if (pageWindow.__PAGEHARVEST_INJECTED__) {
      return;
    }
    pageWindow.__PAGEHARVEST_INJECTED__ = true;

    const router = new MessageRouter();
    const client = new MessagingClient();
    const pickerMessenger = new PickerMessenger();

    const emitToExtension = async (message: ExtensionMessage): Promise<void> => {
      // One-way notification. With no panel open there is simply nobody listening.
      await client.sendToBackground<unknown>(message).catch(() => undefined);
    };

    const coordinator = createContentWorkflowCoordinator(emitToExtension, document, {
      sendToBackground: (message) =>
        client.sendToBackground<unknown>(message, { timeoutMs: BATCH_DELIVERY_TIMEOUT_MS }),
    });

    const withWorkflowError = async <T>(
      operation: () => Promise<T>,
      sourceType: string
    ): Promise<T> => {
      try {
        return await operation();
      } catch (error: unknown) {
        const reported = errorReporter.report('DOM_PARSING', error, {
          context: { originalMessageType: sourceType },
          code: error instanceof DetectionError ? error.code : undefined,
        });
        await emitToExtension({
          id: reported.id,
          type: 'EXTRACTION_ERROR',
          timestamp: reported.timestamp,
          payload: {
            id: reported.id,
            category: reported.category,
            code: reported.code,
            severity: reported.severity,
            message: reported.message,
            timestamp: reported.timestamp,
            context: reported.context,
          },
        });
        throw error;
      }
    };

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

    // Picker lifecycle is owned by the content script so the overlay stays in the page DOM.
    router.on('START_PICKER', (_msg) => {
      pickerMessenger.startPicker();
      return {
        id: `resp_${Date.now()}`,
        type: 'PONG',
        timestamp: Date.now(),
        payload: { status: 'OK', url: window.location.href, title: 'Picker Activated' }
      };
    });

    router.on('STOP_PICKER', () => {
      pickerMessenger.stopPicker();
      return {
        id: `resp_${Date.now()}`,
        type: 'PONG',
        timestamp: Date.now(),
        payload: { status: 'OK', url: window.location.href, title: 'Picker Deactivated' }
      };
    });

    router.on('DETECT_REPEATED_ELEMENTS', (msg: DetectRepeatedElementsMessage) =>
      withWorkflowError(() => coordinator.detectRepeatedElements(msg), msg.type)
    );

    router.on('DETECT_FIELDS', (msg: DetectFieldsMessage) =>
      withWorkflowError(() => coordinator.detectFields(msg), msg.type)
    );

    // The next two reply immediately. A job's progress reaches the background through
    // acknowledged batches, never through this response channel, because navigating
    // to the next page closes the channel.
    router.on('EXTRACT_RECORDS', (msg: ExtractRecordsMessage) => {
      // A picker left open would swallow the clicks the job makes on the page.
      pickerMessenger.stopPicker();
      return coordinator.extractRecords(msg);
    });
    router.on('CONTROL_JOB', (msg: ControlJobMessage) => coordinator.controlJob(msg));
    router.on('QUERY_JOB_RUN', () => coordinator.queryJobRun());
    // Read-only: replies with preview rows and changes nothing (ADR-030).
    router.on('PREVIEW_FIELDS', (msg: PreviewFieldsMessage) => coordinator.previewFields(msg));

    router.listen();

    void emitToExtension({
      id: `content-ready_${Date.now()}`,
      type: 'CONTENT_READY',
      timestamp: Date.now(),
      payload: { url: window.location.href, title: document.title },
    });
  }
});

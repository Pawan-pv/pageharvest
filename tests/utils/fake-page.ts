import { createContentWorkflowCoordinator } from '@/content/workflow-coordinator';
import type { ExtensionMessage } from '@/contracts/messages';
import { messagingService } from '@/services/messaging';

/** A catalogue page: twenty books with a title, a price and a link. */
export function booksHtml(count = 20, extra = ''): string {
  const items = Array.from(
    { length: count },
    (_, i) => `
      <li class="product">
        <h3 class="title"><a href="/book-${i + 1}.html">Book number ${i + 1}</a></h3>
        <p class="price">$${10 + i}.50</p>
      </li>`
  ).join('');
  return `<main><ul class="products">${items}</ul>${extra}</main>`;
}

export const NEXT_LINK = '<ul class="pager"><li class="next"><a href="/page-2.html">next</a></li></ul>';

/** A site menu and nothing else: detection finds it, but it is not data. */
export const MENU_ONLY_HTML = `
  <nav><ul class="menu">
    <li><a href="/">Home</a></li><li><a href="/about">About</a></li>
    <li><a href="/contact">Contact</a></li><li><a href="/help">Help</a></li>
  </ul></nav>`;

export interface FakePage {
  /** The page's own document, separate from the one the panel renders into. */
  document: Document;
  /** Every message type the panel sent to the page, in order. */
  received: string[];
}

/**
 * Stands in for the tab the panel is open on. The real content workflow coordinator runs
 * over a document of its own, so detection, column discovery and previews are the
 * production code; only the browser boundary is the chrome mock. What the page emits
 * reaches the panel the way a content script's messages do.
 */
export function installFakePage(html: string, tabId = 101): FakePage {
  // The panel's messaging service listens to chrome.runtime once, when its module loads, and
  // the chrome mock forgets every listener before each test. Listen again, as a panel that
  // has just opened does.
  (messagingService as unknown as { initRuntimeListener(): void }).initRuntimeListener();

  const page = document.implementation.createHTMLDocument('Books to Scrape');
  page.body.innerHTML = html;
  const received: string[] = [];

  const coordinator = createContentWorkflowCoordinator(
    (message) => {
      chromeMock.notifyFromContentScript(tabId, JSON.parse(JSON.stringify(message)));
    },
    page,
    {
      getCurrentUrl: () => 'http://127.0.0.1:3456/simple-grid.html',
      sendToBackground: (message) => chromeMock.sendFromContentScript(tabId, JSON.parse(JSON.stringify(message))),
    }
  );

  const pong = (title: string) => ({
    id: `pong_${Date.now()}`,
    type: 'PONG',
    timestamp: Date.now(),
    payload: { status: 'OK', url: 'http://127.0.0.1:3456/simple-grid.html', title },
  });

  chromeMock.setTabListener(tabId, (raw, _sender, sendResponse) => {
    const message = raw as ExtensionMessage;
    received.push(message.type);
    const answer = (result: unknown) => {
      void Promise.resolve(result).then(
        (value) => sendResponse(value),
        (error: unknown) => sendResponse({ error: error instanceof Error ? error.message : String(error) })
      );
    };
    switch (message.type) {
      case 'DETECT_REPEATED_ELEMENTS':
        answer(coordinator.detectRepeatedElements(message));
        return true;
      case 'DETECT_FIELDS':
        answer(coordinator.detectFields(message));
        return true;
      case 'PREVIEW_FIELDS':
        answer(coordinator.previewFields(message));
        return true;
      case 'EXTRACT_RECORDS':
        answer(coordinator.extractRecords(message));
        return true;
      case 'CONTROL_JOB':
        answer(coordinator.controlJob(message));
        return true;
      case 'QUERY_JOB_RUN':
        answer(coordinator.queryJobRun());
        return true;
      default:
        answer(pong(message.type));
        return true;
    }
  });

  return { document: page, received };
}

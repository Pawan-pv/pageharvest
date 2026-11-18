import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ExtensionMessage } from '@/contracts/messages';
import { BASE_URL, ExtensionHarness, makeRecipe, renderCards } from '../utils/job-harness';

/**
 * A batch commits, but its reply never reaches the page: the service worker was stopped
 * after the transaction, or the page's request timed out on a large batch. The page sends
 * the same sequence again and the background acknowledges it as already stored
 * ('duplicate', inserted 0), which is the designed at-least-once delivery.
 *
 * "Already stored" is not "nothing new". A page whose rows were stored on the first attempt
 * must not end the job as if it had found no new rows.
 */
const TAB = 640;
const page = (n: number) => `${BASE_URL}/lost-${n}.html`;

async function waitForEnd(harness: ExtensionHarness, jobId: string, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await harness.job(jobId);
    if (job && ['COMPLETED', 'FAILED', 'CANCELLED', 'RECOVERABLE', 'EXPIRED'].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('The job did not end.');
}

describe('A committed batch whose acknowledgement was lost', { timeout: 20000 }, () => {
  let harness: ExtensionHarness;
  let lostReplies: number;

  beforeEach(() => {
    harness = new ExtensionHarness();
    lostReplies = 0;
    document.body.innerHTML = '';
  });

  afterEach(async () => {
    harness.db.close();
    await harness.db.delete();
  });

  /** Loads a document whose first delivery of `loseSequence` is stored, but its reply is lost. */
  function loadLossyPage(url: string, loseSequence: number) {
    let lost = false;
    harness.loadPage(TAB, url, {
      sendToBackground: async (message: ExtensionMessage) => {
        const reply = await harness.sendFromPage(TAB, message);
        if (!lost && message.type === 'RECORD_BATCH' && message.payload.sequence === loseSequence) {
          lost = true;
          lostReplies++;
          throw new Error('The message port closed before a response was received.');
        }
        return reply;
      },
    });
  }

  function serve(documents: Record<string, string[]>, loseOn: Record<string, number> = {}) {
    harness.onNavigate = (tabId, url) => {
      harness.unloadPage(tabId);
      renderCards(documents[url] ?? []);
      if (loseOn[url] !== undefined) loadLossyPage(url, loseOn[url]);
      else harness.loadPage(tabId, url);
      queueMicrotask(() => void harness.announceReady(tabId));
    };
  }

  it('keeps following a URL template after the reply for a stored page was lost', async () => {
    serve({ [page(2)]: ['Two'], [page(3)]: ['Three'], [page(4)]: [] });
    renderCards(['One']);
    loadLossyPage(page(1), 1);

    const identity = await harness.start(
      TAB,
      makeRecipe({ type: 'url_template', urlTemplate: `${BASE_URL}/lost-{page}.html`, maxPages: 5, delayMs: 1000 }),
      page(1)
    );
    const job = await waitForEnd(harness, identity.jobId);

    expect(lostReplies).toBe(1);
    // Page 1 is stored once, and the job went on to the pages after it.
    expect(await harness.titles(identity.datasetId)).toEqual(['One', 'Two', 'Three']);
    expect(job.status).toBe('COMPLETED');
    expect(job.stopReason).toBe('empty_page');
    expect(job.totalExtracted).toBe(3);
  });

  it('still ends a URL template run when a page really adds nothing new (control)', async () => {
    serve({ [page(2)]: ['One'], [page(3)]: ['Never reached'] });
    renderCards(['One']);
    harness.loadPage(TAB, page(1));

    const identity = await harness.start(
      TAB,
      makeRecipe({ type: 'url_template', urlTemplate: `${BASE_URL}/lost-{page}.html`, maxPages: 5, delayMs: 1000 }),
      page(1)
    );
    const job = await waitForEnd(harness, identity.jobId);

    expect(await harness.titles(identity.datasetId)).toEqual(['One']);
    expect(job.stopReason).toBe('no_new_records');
    expect(harness.navigations.map((nav) => nav.url)).toEqual([page(2)]);
  });

  it('stores a single page once when its reply was lost, and completes', async () => {
    renderCards(['A', 'B']);
    loadLossyPage(page(1), 1);

    const identity = await harness.start(TAB, makeRecipe(), page(1));
    const job = await waitForEnd(harness, identity.jobId);

    expect(lostReplies).toBe(1);
    expect(await harness.titles(identity.datasetId)).toEqual(['A', 'B']);
    expect(job.status).toBe('COMPLETED');
    expect(job.totalExtracted).toBe(2);
  });
});

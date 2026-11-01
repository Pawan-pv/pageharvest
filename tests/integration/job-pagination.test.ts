import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BASE_URL, ExtensionHarness, makeBatch, makeRecipe, renderCards } from '../utils/job-harness';

const TAB = 601;
const page = (n: number) => `${BASE_URL}/page-${n}.html`;
const TEMPLATE = `${BASE_URL}/page-{page}.html`;

/**
 * Simulates documents being replaced. The tab shows the content for each URL, and a new
 * content script starts there and reports in, which is what a real navigation does.
 */
function serveDocuments(harness: ExtensionHarness, documents: Record<string, string[] | null>): void {
  harness.onNavigate = (tabId, url) => {
    const titles = documents[url];
    harness.unloadPage(tabId);
    if (titles === null) return; // The page never loads, as with a network failure.
    renderCards(titles ?? []);
    harness.loadPage(tabId, url);
    queueMicrotask(() => void harness.announceReady(tabId));
  };
}

async function waitForEnd(harness: ExtensionHarness, jobId: string, tries = 400) {
  for (let i = 0; i < tries; i++) {
    const job = await harness.job(jobId);
    if (job && ['COMPLETED', 'FAILED', 'CANCELLED', 'RECOVERABLE', 'EXPIRED'].includes(job.status)) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('The job did not end.');
}

describe('Pagination across real document changes', () => {
  let harness: ExtensionHarness;

  beforeEach(() => {
    harness = new ExtensionHarness();
    document.body.innerHTML = '';
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    harness.db.close();
    await harness.db.delete();
  });

  describe('URL template', () => {
    const recipe = (overrides = {}) =>
      makeRecipe({ type: 'url_template', urlTemplate: TEMPLATE, maxPages: 5, delayMs: 200, ...overrides });

    it('visits each page once and stores every row in order', async () => {
      serveDocuments(harness, { [page(2)]: ['Two'], [page(3)]: [] });
      renderCards(['One']);
      harness.loadPage(TAB, page(1));

      const identity = await harness.start(TAB, recipe(), page(1));
      const job = await waitForEnd(harness, identity.jobId);

      expect(await harness.titles(identity.datasetId)).toEqual(['One', 'Two']);
      expect(harness.navigations.map((nav) => nav.url)).toEqual([page(2), page(3)]);
      expect(job.status).toBe('COMPLETED');
      expect(job.stopReason).toBe('empty_page');
    });

    it('stops at the configured page limit without navigating further', async () => {
      serveDocuments(harness, { [page(2)]: ['Two'], [page(3)]: ['Three'] });
      renderCards(['One']);
      harness.loadPage(TAB, page(1));

      const identity = await harness.start(TAB, recipe({ maxPages: 2 }), page(1));
      const job = await waitForEnd(harness, identity.jobId);

      expect(await harness.titles(identity.datasetId)).toEqual(['One', 'Two']);
      expect(harness.navigations.map((nav) => nav.url)).toEqual([page(2)]);
      expect(job.stopReason).toBe('max_pages_reached');
    });

    it('honors the starting page and increment', async () => {
      serveDocuments(harness, { [page(30)]: ['Thirty'], [page(50)]: [] });
      renderCards(['Ten']);
      harness.loadPage(TAB, page(10));

      const identity = await harness.start(TAB, recipe({ startPage: 10, pageIncrement: 20 }), page(10));
      await waitForEnd(harness, identity.jobId);

      expect(harness.navigations.map((nav) => nav.url)).toEqual([page(30), page(50)]);
    });

    it('opens the first page of the template when the tab is somewhere else', async () => {
      serveDocuments(harness, { [page(1)]: ['One'], [page(2)]: [] });
      harness.loadPage(TAB, `${BASE_URL}/landing`);

      const identity = await harness.start(TAB, recipe(), `${BASE_URL}/landing`);
      await waitForEnd(harness, identity.jobId);

      expect(harness.navigations[0].url).toBe(page(1));
      expect(await harness.titles(identity.datasetId)).toEqual(['One']);
    });

    it('stops when a page only repeats rows already stored', async () => {
      serveDocuments(harness, { [page(2)]: ['Same'], [page(3)]: ['Never reached'] });
      renderCards(['Same']);
      harness.loadPage(TAB, page(1));

      const identity = await harness.start(TAB, recipe(), page(1));
      const job = await waitForEnd(harness, identity.jobId);

      expect(await harness.titles(identity.datasetId)).toEqual(['Same']);
      expect(job.stopReason).toBe('no_new_records');
      expect(job.duplicatesSkipped).toBe(1);
      expect(harness.navigations.map((nav) => nav.url)).toEqual([page(2)]);
    });

    it('checkpoints the next URL before leaving the document', async () => {
      const checkpointsAtNavigation: Array<string | undefined> = [];
      harness.onNavigate = () => {
        void harness.db.checkpoints.toArray().then((all) => {
          checkpointsAtNavigation.push(all[0]?.expectedUrl);
        });
      };
      renderCards(['One']);
      harness.loadPage(TAB, page(1));

      const identity = await harness.start(TAB, recipe(), page(1));
      await harness.settled(TAB);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(checkpointsAtNavigation).toEqual([page(2)]);
      expect(await harness.checkpoint(identity.jobId)).toMatchObject({
        awaitingNavigation: true,
        expectedUrl: page(2),
        nextPage: 2,
      });
    });

    it('survives a service worker restart between documents', async () => {
      harness.onNavigate = (tabId, url) => {
        harness.unloadPage(tabId);
        renderCards(url === page(2) ? ['Two'] : []);
        harness.loadPage(tabId, url);
        harness.restartServiceWorker();
        queueMicrotask(() => void harness.announceReady(tabId));
      };
      renderCards(['One']);
      harness.loadPage(TAB, page(1));

      const identity = await harness.start(TAB, recipe(), page(1));
      await waitForEnd(harness, identity.jobId);

      expect(await harness.titles(identity.datasetId)).toEqual(['One', 'Two']);
    });

    it('removes the session and keeps history once finished', async () => {
      serveDocuments(harness, { [page(2)]: [] });
      renderCards(['One']);
      harness.loadPage(TAB, page(1));

      const identity = await harness.start(TAB, recipe(), page(1));
      await waitForEnd(harness, identity.jobId);

      expect(await harness.checkpoint(identity.jobId)).toBeUndefined();
      expect(await harness.db.checkpoints.count()).toBe(0);
      expect(await harness.db.history.where('jobId').equals(identity.jobId).first()).toMatchObject({
        status: 'COMPLETED',
        totalExtracted: 1,
      });
    });

    it('fails when the page that loads is not the one expected', async () => {
      harness.onNavigate = (tabId) => {
        harness.unloadPage(tabId);
        renderCards(['Login']);
        harness.loadPage(tabId, `${BASE_URL}/login`);
        queueMicrotask(() => void harness.announceReady(tabId));
      };
      renderCards(['One']);
      harness.loadPage(TAB, page(1));

      const identity = await harness.start(TAB, recipe(), page(1));
      const job = await waitForEnd(harness, identity.jobId);

      expect(job.status).toBe('FAILED');
      expect(job.errorMessage).toMatch(/Unexpected URL/);
      expect(await harness.titles(identity.datasetId)).toEqual(['One']);
    });

    it('interrupts the job when redirected to another website', async () => {
      harness.onNavigate = (tabId) => {
        harness.unloadPage(tabId);
        harness.loadPage(tabId, 'https://other.example.com/');
        queueMicrotask(() => void harness.announceReady(tabId));
      };
      renderCards(['One']);
      harness.loadPage(TAB, page(1));

      const identity = await harness.start(TAB, recipe(), page(1));
      const job = await waitForEnd(harness, identity.jobId);

      expect(job.status).toBe('RECOVERABLE');
      expect(job.interruptedReason).toMatch(/left the site/);
    });

    it('refuses a template for another website before doing anything', async () => {
      harness.loadPage(TAB, page(1));

      const result = await harness.coordinator.startJob({
        recipe: recipe({ urlTemplate: 'https://other.example.com/?p={page}' }),
        tabId: TAB,
        sourceUrl: page(1),
      });

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/must stay on/);
      expect(await harness.db.jobs.count()).toBe(0);
    });

    it('cancelling during the delay before navigation prevents the navigation', async () => {
      renderCards(['One']);
      harness.loadPage(TAB, page(1));

      const identity = await harness.start(TAB, recipe({ delayMs: 5000 }), page(1));
      await vi.waitFor(async () => {
        expect((await harness.job(identity.jobId))?.lastSequence).toBe(1);
      });
      await harness.coordinator.cancelJob(identity.jobId);
      await harness.settled(TAB);

      expect(harness.navigations).toHaveLength(0);
      expect(await harness.titles(identity.datasetId)).toEqual(['One']);
    });

    it('resumes from the saved next page after an interruption, with no duplicates', async () => {
      renderCards(['One']);
      harness.loadPage(TAB, page(1));
      const identity = await harness.start(TAB, recipe(), page(1));
      await vi.waitFor(async () => {
        expect((await harness.job(identity.jobId))?.lastSequence).toBe(1);
      });
      harness.closeTab(TAB);
      await harness.coordinator.handleTabClosed(TAB);
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect((await harness.job(identity.jobId))?.status).toBe('RECOVERABLE');

      serveDocuments(harness, { [page(2)]: ['Two'], [page(3)]: [] });
      await harness.coordinator.recoverJob(identity.jobId);
      await waitForEnd(harness, identity.jobId);

      expect(await harness.titles(identity.datasetId)).toEqual(['One', 'Two']);
      expect((await harness.job(identity.jobId))?.lastSequence).toBe(3);
    });
  });

  describe('Next button with ordinary links', () => {
    const NEXT = (href: string) => `<a id="next" rel="next" href="${href}">Next</a>`;
    const recipe = (overrides = {}) => makeRecipe({ type: 'next_button', maxPages: 5, ...overrides });

    /** Clicking a real link replaces the document, which jsdom does not do by itself. */
    function serveLinkedPages(pages: Record<string, { titles: string[]; next?: string }>) {
      const show = (url: string) => {
        const entry = pages[url];
        renderCards(entry.titles, entry.next ? NEXT(entry.next) : '');
        harness.loadPage(TAB, url);
        document.getElementById('next')?.addEventListener('click', (event) => {
          event.preventDefault();
          const target = (event.currentTarget as HTMLAnchorElement).href;
          harness.unloadPage(TAB);
          setTimeout(() => {
            show(target);
            void harness.announceReady(TAB);
          }, 1);
        });
      };
      return show;
    }

    it('continues across documents instead of stopping after the first page', async () => {
      const show = serveLinkedPages({
        [page(1)]: { titles: ['One'], next: page(2) },
        [page(2)]: { titles: ['Two'], next: page(3) },
        [page(3)]: { titles: ['Three'] },
      });
      show(page(1));

      const identity = await harness.start(TAB, recipe(), page(1));
      const job = await waitForEnd(harness, identity.jobId);

      expect(await harness.titles(identity.datasetId)).toEqual(['One', 'Two', 'Three']);
      expect(job.status).toBe('COMPLETED');
      expect(job.stopReason).toBe('control_disabled_or_missing');
      expect(job.pagesVisited).toBe(3);
    });

    it('stops at maxPages across documents', async () => {
      const show = serveLinkedPages({
        [page(1)]: { titles: ['One'], next: page(2) },
        [page(2)]: { titles: ['Two'], next: page(3) },
        [page(3)]: { titles: ['Three'] },
      });
      show(page(1));

      const identity = await harness.start(TAB, recipe({ maxPages: 2 }), page(1));
      const job = await waitForEnd(harness, identity.jobId);

      expect(await harness.titles(identity.datasetId)).toEqual(['One', 'Two']);
      expect(job.stopReason).toBe('max_pages_reached');
    });

    it('detects a loop of pages linking back to one already visited', async () => {
      const show = serveLinkedPages({
        [page(1)]: { titles: ['One'], next: page(2) },
        [page(2)]: { titles: ['Two'], next: page(1) },
      });
      show(page(1));

      const identity = await harness.start(TAB, recipe(), page(1));
      const job = await waitForEnd(harness, identity.jobId);

      expect(job.stopReason).toBe('repeated_url');
      expect(await harness.titles(identity.datasetId)).toEqual(['One', 'Two']);
    });

    it('will not follow a next link to another website', async () => {
      const show = serveLinkedPages({
        [page(1)]: { titles: ['One'], next: 'https://other.example.com/page-2' },
      });
      show(page(1));

      const identity = await harness.start(TAB, recipe(), page(1));
      const job = await waitForEnd(harness, identity.jobId);

      expect(job.stopReason).toBe('cross_origin_blocked');
      expect(await harness.titles(identity.datasetId)).toEqual(['One']);
    });

    it('saves the checkpoint before clicking, so an unloaded page loses nothing', async () => {
      let checkpointAtClick: unknown;
      renderCards(['One'], NEXT(page(2)));
      harness.loadPage(TAB, page(1));
      document.getElementById('next')?.addEventListener('click', (event) => {
        event.preventDefault();
        checkpointAtClick = harness.db.checkpoints.toArray();
        harness.unloadPage(TAB);
      });

      const identity = await harness.start(TAB, recipe(), page(1));
      await vi.waitFor(() => expect(checkpointAtClick).toBeDefined());

      expect((await (checkpointAtClick as Promise<unknown[]>))[0]).toMatchObject({
        awaitingNavigation: true,
        expectedUrl: page(2),
        nextPage: 2,
      });
      expect(await harness.titles(identity.datasetId)).toEqual(['One']);
    });

    it('also handles an in-page next button that never leaves the document', async () => {
      let current = 1;
      const render = () => {
        renderCards([`Page ${current}`], current < 3 ? '<button id="more">Next</button>' : '');
        document.getElementById('more')?.addEventListener('click', () => {
          current += 1;
          render();
        });
      };
      render();
      harness.loadPage(TAB, page(1));

      const identity = await harness.start(TAB, recipe(), page(1));
      const job = await waitForEnd(harness, identity.jobId);

      expect(await harness.titles(identity.datasetId)).toEqual(['Page 1', 'Page 2', 'Page 3']);
      expect(job.status).toBe('COMPLETED');
    });
  });

  describe('Infinite scroll', () => {
    function renderFeed() {
      let next = 2;
      renderCards(['Post 1']);
      const list = document.querySelector('section') as HTMLElement;
      window.scrollBy = vi.fn(() => {
        const card = document.createElement('article');
        card.className = 'card';
        card.innerHTML = `<h2 class="title">Post ${next}</h2>`;
        next += 1;
        list.appendChild(card);
      }) as unknown as typeof window.scrollBy;
    }

    it('limits scrolling by maxScrolls, reads the limit from the job, and ignores maxPages', async () => {
      renderFeed();
      harness.loadPage(TAB, page(1));

      const identity = await harness.start(
        TAB,
        makeRecipe({ type: 'infinite_scroll', scrollCount: 3, maxPages: 1, scrollDelayMs: 300 }),
        page(1)
      );
      const job = await waitForEnd(harness, identity.jobId, 800);

      expect(window.scrollBy).toHaveBeenCalledTimes(3);
      expect(job.stopReason).toBe('max_scrolls_reached');
      expect(job.progressKind).toBe('scrolls');
      expect(job.targetSteps).toBe(3);
      expect(job.scrollsCompleted).toBeGreaterThanOrEqual(2);
      expect(await harness.titles(identity.datasetId)).toEqual(['Post 1', 'Post 2', 'Post 3', 'Post 4']);
    }, 15000);

    it('reports pages and scrolls in their own units, never an impossible denominator', async () => {
      renderFeed();
      harness.loadPage(TAB, page(1));

      const identity = await harness.start(
        TAB,
        makeRecipe({ type: 'infinite_scroll', scrollCount: 2, maxPages: 500, scrollDelayMs: 300 }),
        page(1)
      );
      await waitForEnd(harness, identity.jobId, 800);

      const updates = harness.broadcasts.flatMap((message) =>
        message.type === 'JOB_UPDATED' && message.payload.jobId === identity.jobId ? [message.payload] : []
      );
      expect(updates.length).toBeGreaterThan(0);
      for (const update of updates) {
        expect(update.progressKind).toBe('scrolls');
        expect(update.targetSteps).toBe(2);
        expect(update.currentStep).toBeLessThanOrEqual(2);
      }
    }, 15000);

    it('keeps the progress dimension and limit through recovery', async () => {
      const { coordinator } = harness.loadPage(TAB, page(1));
      vi.spyOn(coordinator, 'extractRecords').mockReturnValue({ accepted: true });
      const identity = await harness.start(
        TAB,
        makeRecipe({ type: 'infinite_scroll', scrollCount: 7, scrollDelayMs: 300 }),
        page(1)
      );
      await harness.sendFromPage(
        TAB,
        makeBatch(identity, 1, ['Post 1'], {
          navigation: {
            nextPage: 2,
            scrollsCompleted: 4,
            awaitingNavigation: false,
            visitedUrls: [],
            url: page(1),
          },
        })
      );
      await harness.coordinator.handleTabClosed(TAB);
      await harness.coordinator.recoverJob(identity.jobId);

      const job = await harness.job(identity.jobId);
      expect(job).toMatchObject({ progressKind: 'scrolls', targetSteps: 7, scrollsCompleted: 4 });
      // The feed reloads from the top, so earlier scrolls are repeated before counting on.
      expect(await harness.checkpoint(identity.jobId)).toMatchObject({
        catchUpScrolls: 4,
        scrollsCompleted: 0,
        expectedUrl: page(1),
      });
    });

    it('does not end a resumed feed early while it scrolls back through known rows', async () => {
      renderFeed();
      harness.loadPage(TAB, page(1));

      const { coordinator } = harness.loadPage(TAB, page(1));
      const extract = vi.spyOn(coordinator, 'extractRecords').mockReturnValue({ accepted: true });
      const identity = await harness.start(
        TAB,
        makeRecipe({ type: 'infinite_scroll', scrollCount: 4, scrollDelayMs: 300 }),
        page(1)
      );
      for (const [sequence, title, scrolls] of [
        [1, 'Post 1', 0],
        [2, 'Post 2', 1],
        [3, 'Post 3', 2],
      ] as const) {
        await harness.sendFromPage(
          TAB,
          makeBatch(identity, sequence, [title], {
            navigation: {
              nextPage: sequence + 1,
              scrollsCompleted: scrolls,
              awaitingNavigation: false,
              visitedUrls: [],
              url: page(1),
            },
          })
        );
      }
      await harness.coordinator.handleTabClosed(TAB);
      extract.mockRestore();
      await harness.coordinator.recoverJob(identity.jobId);
      const tabId = (await harness.job(identity.jobId))?.tabId as number;

      renderFeed();
      harness.loadPage(tabId, page(1));
      await harness.announceReady(tabId);
      const job = await waitForEnd(harness, identity.jobId, 1200);

      expect(job.status).toBe('COMPLETED');
      expect(job.stopReason).toBe('max_scrolls_reached');
      expect(await harness.titles(identity.datasetId)).toEqual([
        'Post 1',
        'Post 2',
        'Post 3',
        'Post 4',
        'Post 5',
      ]);
    }, 20000);

    it('pauses and cancels the real page run', async () => {
      renderFeed();
      const pageRun = harness.loadPage(TAB, page(1));

      const identity = await harness.start(
        TAB,
        makeRecipe({ type: 'infinite_scroll', scrollCount: 50, scrollDelayMs: 300 }),
        page(1)
      );
      await vi.waitFor(async () => {
        expect((await harness.job(identity.jobId))?.lastSequence).toBeGreaterThanOrEqual(1);
      });

      await harness.coordinator.pauseJob(identity.jobId);
      expect(pageRun.coordinator.queryJobRun().paused).toBe(true);
      // Anything already past the gate finishes first; after that nothing moves.
      await new Promise((resolve) => setTimeout(resolve, 700));
      const scrollsWhilePaused = vi.mocked(window.scrollBy).mock.calls.length;
      const rowsWhilePaused = (await harness.rows(identity.datasetId)).length;
      await new Promise((resolve) => setTimeout(resolve, 700));
      expect(vi.mocked(window.scrollBy).mock.calls.length).toBe(scrollsWhilePaused);
      expect(await harness.rows(identity.datasetId)).toHaveLength(rowsWhilePaused);

      await harness.coordinator.cancelJob(identity.jobId);
      await harness.settled(TAB);

      expect(pageRun.coordinator.queryJobRun().active).toBe(false);
      expect(vi.mocked(window.scrollBy).mock.calls.length).toBe(scrollsWhilePaused);
      expect(await harness.rows(identity.datasetId)).toHaveLength(rowsWhilePaused);
    }, 15000);
  });

  describe('Automatic stops', () => {
    it('ends a job after repeated batches with nothing new, even across documents', async () => {
      const { coordinator } = harness.loadPage(TAB, page(1));
      vi.spyOn(coordinator, 'extractRecords').mockReturnValue({ accepted: true });
      const identity = await harness.start(TAB, makeRecipe({ type: 'next_button' }), page(1));

      await harness.sendFromPage(TAB, makeBatch(identity, 1, []));
      await harness.sendFromPage(TAB, makeBatch(identity, 2, []));
      const ack = await harness.sendFromPage(TAB, makeBatch(identity, 3, []));

      expect(ack.shouldStop).toBe(true);
      const job = await harness.job(identity.jobId);
      expect(job).toMatchObject({ status: 'COMPLETED', stopReason: 'no_new_records' });
      expect(await harness.checkpoint(identity.jobId)).toBeUndefined();
    });

    it('ends a job at the record limit across documents', async () => {
      const { coordinator } = harness.loadPage(TAB, page(1));
      vi.spyOn(coordinator, 'extractRecords').mockReturnValue({ accepted: true });
      const identity = await harness.start(TAB, makeRecipe({ type: 'next_button', maxRecords: 2 }), page(1));

      await harness.sendFromPage(TAB, makeBatch(identity, 1, ['A']));
      const ack = await harness.sendFromPage(TAB, makeBatch(identity, 2, ['B']));

      expect(ack.shouldStop).toBe(true);
      expect((await harness.job(identity.jobId))?.stopReason).toBe('max_records_reached');
    });

    it('fails a job with an invalid container selector and records it', async () => {
      renderCards(['One']);
      harness.loadPage(TAB, page(1));

      const identity = await harness.start(
        TAB,
        makeRecipe({}, { containerSelector: '###not-valid' }),
        page(1)
      );
      const job = await waitForEnd(harness, identity.jobId);

      expect(job.status).toBe('FAILED');
      expect(job.errorMessage).toMatch(/not a valid CSS selector/);
      expect((await harness.db.history.where('jobId').equals(identity.jobId).first())?.status).toBe('FAILED');
    });
  });
});

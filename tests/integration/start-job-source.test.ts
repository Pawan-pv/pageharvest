import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChromeJobTransport } from '@/background/chrome-job-transport';
import type { JobTransport } from '@/background/job-coordinator';
import { MessagingClient } from '@/platform/messaging-client';
import { PageHarvestDB } from '@/storage/db';
import { installBackground, makeRecipe, uniqueDb } from '../utils/job-harness';

const TAB = 901;
const LIST_PAGE = 'http://localhost:3000/list';

/**
 * START_JOB carries the address of the page the list was found on. The background checks
 * it against the page the tab really shows before it creates anything, so a list found on
 * one page can never run on another, whatever the panel believed.
 */
describe('Starting a job on the page its list came from', () => {
  let db: PageHarvestDB;

  beforeEach(() => {
    db = uniqueDb();
  });

  afterEach(async () => {
    db.close();
    await db.delete();
  });

  function start(tabUrl: string | undefined) {
    const transport: JobTransport = {
      sendToTab: async () => ({ accepted: true }),
      broadcast: async () => undefined,
      openBlankTab: async () => 900,
      navigateTab: async () => undefined,
      getTabLoadStatus: async () => 'complete',
      injectContentScript: async () => ({ injected: false, url: LIST_PAGE }),
      getTabUrl: async () => tabUrl,
    };
    const { coordinator } = installBackground(db, { transport });
    return coordinator.startJob({
      recipe: makeRecipe({ type: 'none' }),
      tabId: TAB,
      sourceUrl: LIST_PAGE,
    });
  }

  it('refuses, and stores nothing, when the tab now shows another page', async () => {
    const result = await start('http://localhost:3000/somewhere-else');

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not the page the list was found on/);
    expect(await db.jobs.count()).toBe(0);
    expect(await db.datasets.count()).toBe(0);
    expect(await db.checkpoints.count()).toBe(0);
  });

  it('starts when the tab still shows that page, ignoring a #fragment', async () => {
    const result = await start(`${LIST_PAGE}#reviews`);

    expect(result.ok).toBe(true);
    expect(await db.jobs.count()).toBe(1);
  });

  it('starts when Chrome cannot say what the tab shows', async () => {
    const result = await start(undefined);

    expect(result.ok).toBe(true);
    expect(await db.jobs.count()).toBe(1);
  });

  it('reads the tab address from Chrome in the production transport', async () => {
    Object.assign(chrome.tabs, {
      get: async (tabId: number) => ({ id: tabId, url: 'http://localhost:3000/from-chrome' }),
    });
    const transport = createChromeJobTransport(new MessagingClient());

    expect(await transport.getTabUrl?.(TAB)).toBe('http://localhost:3000/from-chrome');
  });
});

describe('Resuming a job uses the page the job was on, not the tab in front', () => {
  let db: PageHarvestDB;

  beforeEach(() => {
    db = uniqueDb();
  });

  afterEach(async () => {
    db.close();
    await db.delete();
  });

  it("opens a new tab on the job's own page and runs the job there", async () => {
    const navigateTab = vi.fn(async () => undefined);
    const transport: JobTransport = {
      sendToTab: async () => ({ accepted: true }),
      broadcast: async () => undefined,
      openBlankTab: async () => 900,
      navigateTab,
      getTabLoadStatus: async () => 'complete',
      injectContentScript: async () => ({ injected: false, url: LIST_PAGE }),
      // Whatever tab the user has in front now is never consulted.
      getTabUrl: async () => 'http://localhost:3000/the-tab-in-front',
    };
    const { coordinator } = installBackground(db, { transport });
    // Started while the job's tab showed the list page.
    transport.getTabUrl = async () => LIST_PAGE;
    const started = await coordinator.startJob({ recipe: makeRecipe({ type: 'none' }), tabId: TAB, sourceUrl: LIST_PAGE });
    const jobId = started.identity?.jobId ?? '';
    expect(started.ok).toBe(true);
    await coordinator.handleTabClosed(TAB);
    transport.getTabUrl = async () => 'http://localhost:3000/the-tab-in-front';

    const resumed = await coordinator.recoverJob(jobId);

    expect(resumed.ok).toBe(true);
    expect(navigateTab).toHaveBeenCalledWith(900, LIST_PAGE);
    expect((await db.jobs.get(jobId))?.tabId).toBe(900);
  });
});

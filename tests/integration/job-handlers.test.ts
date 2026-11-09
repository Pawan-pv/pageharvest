import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChromeJobTransport } from '@/background/chrome-job-transport';
import { MessagingClient } from '@/platform/messaging-client';
import { TabManager } from '@/platform/tab-manager';
import { PageHarvestDB } from '@/storage/db';
import { installBackground, makeBatch, makeRecipe, uniqueDb } from '../utils/job-harness';

const TAB = 901;
const envelope = { id: 'm1', timestamp: 1 };

function startMessage() {
  return {
    ...envelope,
    type: 'START_JOB',
    payload: { recipe: makeRecipe({ type: 'next_button' }), tabId: TAB, sourceUrl: 'http://localhost:3000/list' },
  };
}

function fromPanel(message: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, resolve);
  });
}

describe('Message routing to the job coordinator', () => {
  let db: PageHarvestDB;

  beforeEach(() => {
    db = uniqueDb();
    installBackground(db);
  });

  afterEach(async () => {
    db.close();
    await db.delete();
  });

  it('creates a job when the side panel asks', async () => {
    const result = (await fromPanel(startMessage())) as { ok: boolean };

    expect(result.ok).toBe(true);
    expect(await db.jobs.count()).toBe(1);
  });

  it('refuses job commands that come from a content script', async () => {
    const result = (await chromeMock.sendFromContentScript(TAB, startMessage())) as { ok: boolean };

    expect(result.ok).toBe(false);
    expect(await db.jobs.count()).toBe(0);
  });

  it('refuses job reports that come from the side panel', async () => {
    const started = (await fromPanel(startMessage())) as {
      identity: Parameters<typeof makeBatch>[0];
    };

    const ack = (await fromPanel(makeBatch(started.identity, 1, ['Forged']))) as { status: string };

    expect(ack.status).toBe('rejected');
    expect(await db.records.count()).toBe(0);
  });

  it('commits a batch that comes from the job tab through the validated router', async () => {
    const started = (await fromPanel(startMessage())) as {
      identity: Parameters<typeof makeBatch>[0];
    };

    const ack = (await chromeMock.sendFromContentScript(
      TAB,
      makeBatch(started.identity, 1, ['Real'])
    )) as { status: string };

    expect(ack.status).toBe('committed');
    expect(await db.records.count()).toBe(1);
  });

  it('rejects a malformed message before it reaches the coordinator', async () => {
    const reply = (await fromPanel({ ...envelope, type: 'RECORD_BATCH', payload: { sequence: 1 } })) as {
      ok: boolean;
      error: string;
    };

    expect(reply.ok).toBe(false);
    expect(reply.error).toMatch(/INVALID_MESSAGE/);
  });

  it('ignores content from another extension', () => {
    const listener = vi.fn();
    chrome.runtime.onMessage.addListener(listener);
    const reply = vi.fn();

    const routerListener = Array.from(
      (chromeMock as unknown as { runtimeListeners: Set<(...args: unknown[]) => unknown> }).runtimeListeners
    )[0];
    routerListener(startMessage(), { id: 'some-other-extension' }, reply);

    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  });

  it('still accepts CONTENT_READY, which the on-demand content script no longer sends (ADR-037)', async () => {
    const reply = await chromeMock.sendFromContentScript(TAB, {
      ...envelope,
      type: 'CONTENT_READY',
      payload: { url: 'http://localhost:3000/page-2' },
    });
    expect(reply).toEqual({ ok: true });
  });
});

describe('Chrome transport for the coordinator', () => {
  it('sends tab messages through the validated client', async () => {
    const client = new MessagingClient();
    const send = vi.spyOn(client, 'sendToTab').mockResolvedValue({ accepted: true });
    const transport = createChromeJobTransport(client);
    const message = { id: 'x', timestamp: 1, type: 'QUERY_JOB_RUN' as const, payload: {} };

    await transport.sendToTab(5, message);

    expect(send).toHaveBeenCalledWith(5, message, expect.objectContaining({ timeoutMs: expect.any(Number) }));
  });

  it('injects the content script only into a document that does not run it yet', async () => {
    const transport = createChromeJobTransport(new MessagingClient());
    const execute = chromeMock.scripting.executeScript;

    execute.mockResolvedValueOnce([{ result: { present: false, url: 'http://localhost:3000/page-2' } }]);
    expect(await transport.injectContentScript(5)).toEqual({ injected: true, url: 'http://localhost:3000/page-2' });
    expect(execute).toHaveBeenLastCalledWith({ target: { tabId: 5 }, files: ['content-scripts/content.js'] });

    execute.mockClear();
    execute.mockResolvedValueOnce([{ result: { present: true, url: 'http://localhost:3000/page-2' } }]);
    expect(await transport.injectContentScript(5)).toEqual({ injected: false, url: 'http://localhost:3000/page-2' });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('lets a refused injection fail, so the coordinator can check the site grant', async () => {
    const transport = createChromeJobTransport(new MessagingClient());
    chromeMock.scripting.executeScript.mockRejectedValueOnce(new Error('Cannot access contents of the page.'));
    await expect(transport.injectContentScript(5)).rejects.toThrow('Cannot access contents of the page.');
  });

  it('does not treat a closed side panel as a broadcast failure', async () => {
    const client = new MessagingClient();
    vi.spyOn(client, 'sendToBackground').mockRejectedValue(new Error('Receiving end does not exist.'));
    const transport = createChromeJobTransport(client);

    await expect(
      transport.broadcast({ id: 'x', timestamp: 1, type: 'RECONCILE_JOBS', payload: {} })
    ).resolves.toBeUndefined();
  });

  it('reports a tab that no longer exists', async () => {
    const original = chrome.tabs.get;
    chrome.tabs.get = vi.fn().mockRejectedValue(new Error('No tab with id')) as never;

    expect(await createChromeJobTransport().getTabLoadStatus(5)).toBeNull();

    chrome.tabs.get = original;
  });
});

describe('Tab lifecycle events', () => {
  it('reports any tab closing and any tab finishing loading, active or not', () => {
    const manager = new TabManager();
    const closed = vi.fn();
    const loaded = vi.fn();
    manager.onTabClosed(closed);
    manager.onTabLoaded(loaded);
    const inactive = { id: 7, active: false } as chrome.tabs.Tab;

    chromeMock.triggerTabRemoved(7);
    chromeMock.triggerTabUpdated(7, { status: 'complete' }, inactive);
    chromeMock.triggerTabUpdated(7, { status: 'loading' }, inactive);

    expect(closed).toHaveBeenCalledWith(7);
    expect(loaded).toHaveBeenCalledTimes(1);
    expect(loaded).toHaveBeenCalledWith(7);

    manager.destroy();
  });
});

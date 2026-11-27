import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../entrypoints/sidepanel/App';
import type { JobTransport } from '@/background/job-coordinator';
import type { ExtensionMessage } from '@/contracts/messages';
import { db } from '@/storage/db';
import { installBackground, makeRecipe } from '../utils/job-harness';
import { useExtractionWorkflow } from '@/hooks/useExtractionWorkflow';
import type { TabInfo } from '@/services/messaging';
import type { ExtractionRecipe } from '@/types';
import { booksHtml, installFakePage } from '../utils/fake-page';
import { usePanelMode } from '../utils/panel-mode';

const TAB_A = 101;
const TAB_B = 202;
const URL_A = 'http://127.0.0.1:3456/simple-grid.html';
const URL_B = 'http://127.0.0.1:3456/job-listings.html';

const JOBS_HTML = `<main>${Array.from(
  { length: 4 },
  (_, i) => `<article class="job"><h2 class="role">Role ${i + 1}</h2><p class="pay">Pay ${i + 1}</p></article>`
).join('')}</main>`;

/** The real background, reaching each tab's page the way Chrome does. */
function installBackgroundThatReachesThePages() {
  const transport: JobTransport = {
    sendToTab: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
    broadcast: async () => undefined,
    openBlankTab: async () => 900,
    navigateTab: async () => undefined,
    getTabLoadStatus: async () => 'complete',
    injectContentScript: async (tabId) => ({ injected: false, url: tabId === TAB_B ? URL_B : URL_A }),
  };
  return installBackground(db, { transport });
}

/** Puts a tab in front, as the user clicking it does. The panel follows the active tab. */
async function activate(tabId: number, url: string, title: string) {
  await act(async () => {
    chromeMock.activeTab = { ...chromeMock.activeTab, id: tabId, url, title };
    chromeMock.triggerTabActivated({ tabId, windowId: 1 });
  });
}

async function findTheListOnTabA(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /Find Data on This Page|Get the list on this page/i }));
  await user.click(await screen.findByRole('button', { name: /Auto-detect on this page/i }));
  await screen.findByText(/Found 20 items/);
  expect(screen.getByRole('button', { name: 'Start Extraction' })).not.toBeDisabled();
}

describe('A found list belongs to the tab and page it came from', () => {
  let tabsUpdate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await db.clearAllData();
    await usePanelMode('simple');
    installBackgroundThatReachesThePages();
    tabsUpdate = vi.fn(async () => ({}));
    Object.assign(chrome.tabs, { update: tabsUpdate });
    chromeMock.activeTab = { ...chromeMock.activeTab, id: TAB_A, url: URL_A, title: 'Books' };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not start a job on another tab with this list, and works again back on its tab', async () => {
    const user = userEvent.setup();
    installFakePage(booksHtml(20), TAB_A, { url: URL_A });
    const pageB = installFakePage(JOBS_HTML, TAB_B, { url: URL_B, listen: false });
    render(<App />);
    await findTheListOnTabA(user);

    await activate(TAB_B, URL_B, 'Jobs');
    expect(await screen.findByText('This list is on another tab')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start Extraction' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Found 20 items/)).not.toBeInTheDocument();

    // "Go back to that tab" brings tab A to the front.
    await user.click(screen.getByRole('button', { name: 'Go back to that tab' }));
    expect(tabsUpdate).toHaveBeenCalledWith(TAB_A, { active: true });

    await activate(TAB_A, URL_A, 'Books');
    await screen.findByText(/Found 20 items/);
    expect(screen.queryByText('This list is on another tab')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start Extraction' }));
    expect(await screen.findByRole('heading', { name: 'Extraction complete' }, { timeout: 20000 })).toBeInTheDocument();

    const jobs = await db.jobs.toArray();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ tabId: TAB_A, targetUrl: URL_A, totalExtracted: 20 });
    // Tab B's page was never asked for anything.
    expect(pageB.received).toEqual([]);
  });

  it('starts again on the other tab when the user asks, without the old list', async () => {
    const user = userEvent.setup();
    installFakePage(booksHtml(20), TAB_A, { url: URL_A });
    installFakePage(JOBS_HTML, TAB_B, { url: URL_B, listen: false });
    render(<App />);
    await findTheListOnTabA(user);

    await activate(TAB_B, URL_B, 'Jobs');
    await user.click(await screen.findByRole('button', { name: 'Start again on this page' }));
    expect(await screen.findByRole('button', { name: /Find Data on This Page|Get the list on this page/i })).toBeInTheDocument();
    expect(screen.queryByText('This list is on another tab')).not.toBeInTheDocument();
    expect(await db.jobs.count()).toBe(0);
  });

  it('drops the list, with a plain message, when its page is replaced', async () => {
    const user = userEvent.setup();
    installFakePage(booksHtml(20), TAB_A, { url: URL_A });
    render(<App />);
    await findTheListOnTabA(user);

    const moved = 'http://127.0.0.1:3456/other-page.html';
    await act(async () => {
      chromeMock.activeTab = { ...chromeMock.activeTab, id: TAB_A, url: moved };
      chromeMock.triggerTabUpdated(TAB_A, { url: moved }, chromeMock.activeTab);
    });
    expect(await screen.findByText(/The page changed, so the list you found is gone/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Auto-detect on this page/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start Extraction' })).toBeDisabled();
  });

  it('drops the list when its tab is closed while the user is on another tab', async () => {
    const user = userEvent.setup();
    installFakePage(booksHtml(20), TAB_A, { url: URL_A });
    installFakePage(JOBS_HTML, TAB_B, { url: URL_B, listen: false });
    render(<App />);
    await findTheListOnTabA(user);

    await activate(TAB_B, URL_B, 'Jobs');
    await screen.findByText('This list is on another tab');
    await act(async () => {
      chromeMock.triggerTabRemoved(TAB_A);
    });
    expect(await screen.findByText(/The page changed, so the list you found is gone/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Auto-detect on this page/i })).toBeInTheDocument();
  });

  it('ignores what a page in another tab reports', async () => {
    const user = userEvent.setup();
    installFakePage(booksHtml(20), TAB_A, { url: URL_A });
    render(<App />);
    await findTheListOnTabA(user);

    const fromOtherTab: ExtensionMessage = {
      id: 'other_tab_detected',
      type: 'REPEATED_ELEMENTS_DETECTED',
      timestamp: Date.now(),
      payload: { containerSelector: 'article.job', matchCount: 4, sampleSnippets: ['Role 1'] },
    } as ExtensionMessage;
    await act(async () => {
      chromeMock.notifyFromContentScript(TAB_B, fromOtherTab);
    });
    await screen.findByText(/Found 20 items/);
    expect(screen.queryByText(/We found 4 items/)).not.toBeInTheDocument();
  });
});

describe('A saved setup, and its preview, belong to the tab it was opened on', () => {
  beforeEach(async () => {
    await db.clearAllData();
    installBackgroundThatReachesThePages();
  });

  const tabA: TabInfo = { id: TAB_A, url: URL_A, title: 'Books', isInjectable: true };
  const tabB: TabInfo = { id: TAB_B, url: URL_B, title: 'Jobs', isInjectable: true };

  it('refuses the preview and the start on another tab, and allows both back on its own', async () => {
    const pageA = installFakePage(booksHtml(20), TAB_A, { url: URL_A });
    const pageB = installFakePage(JOBS_HTML, TAB_B, { url: URL_B, listen: false });
    const recipe = { ...makeRecipe(), containerSelector: 'li.product', urlPattern: URL_A } as unknown as ExtractionRecipe;
    const { result, rerender } = renderHook(({ tab }) => useExtractionWorkflow(tab), { initialProps: { tab: tabA } });

    act(() => result.current.loadRecipe(recipe));
    await waitFor(() => expect(result.current.view).toBe('config_fields'));
    expect(result.current.listSource).toMatchObject({ tabId: TAB_A, url: URL_A });

    rerender({ tab: tabB });
    expect(result.current.listElsewhere).toBe(true);
    const refused = await result.current.previewFields(recipe.fields);
    expect(refused).toMatchObject({ ok: false, message: 'This list is on another tab.' });
    await act(async () => {
      await result.current.startExtraction();
    });
    expect(result.current.operationError?.message).toMatch(/This list is on another tab/);
    expect(await db.jobs.count()).toBe(0);
    expect(pageB.received).toEqual([]);

    rerender({ tab: tabA });
    expect(result.current.listElsewhere).toBe(false);
    const preview = await result.current.previewFields(recipe.fields);
    expect(preview.ok).toBe(true);
    expect(pageA.received).toContain('PREVIEW_FIELDS');
  });
});

describe('The picker stops when the panel leaves it', () => {
  let port: { name: string; disconnect: ReturnType<typeof vi.fn>; onDisconnect: { addListener: () => void } };
  let connect: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await db.clearAllData();
    await usePanelMode('simple');
    installBackgroundThatReachesThePages();
    chromeMock.activeTab = { ...chromeMock.activeTab, id: TAB_A, url: URL_A, title: 'Books' };
    port = { name: 'pageharvest-picker', disconnect: vi.fn(), onDisconnect: { addListener: () => undefined } };
    connect = vi.fn(() => port);
    Object.assign(chrome.tabs, { connect });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('holds the picking tab while picking, and lets go when the panel closes', async () => {
    const user = userEvent.setup();
    const pageA = installFakePage(booksHtml(20), TAB_A, { url: URL_A });
    const view = render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Pick element on page' }));
    expect(await screen.findByRole('heading', { name: 'Click one item on the page' })).toBeInTheDocument();
    expect(connect).toHaveBeenCalledWith(TAB_A, { name: 'pageharvest-picker' });
    expect(pageA.received).toContain('START_PICKER');

    view.unmount();
    expect(port.disconnect).toHaveBeenCalled();
  });

  it('stops the picker on its own tab, and says so, when the user switches tabs', async () => {
    const user = userEvent.setup();
    const pageA = installFakePage(booksHtml(20), TAB_A, { url: URL_A });
    const pageB = installFakePage(JOBS_HTML, TAB_B, { url: URL_B, listen: false });
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Pick element on page' }));
    await screen.findByRole('heading', { name: 'Click one item on the page' });

    await activate(TAB_B, URL_B, 'Jobs');

    expect(await screen.findByText(/Picking stopped because you switched to another tab/)).toBeInTheDocument();
    await waitFor(() => expect(pageA.received).toContain('STOP_PICKER'));
    expect(pageB.received).toEqual([]);
    expect(port.disconnect).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Find Data on This Page|Get the list on this page/i })).toBeInTheDocument();
  });
});

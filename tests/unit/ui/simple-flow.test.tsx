import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../../entrypoints/sidepanel/App';
import type { JobTransport } from '@/background/job-coordinator';
import { db } from '@/storage/db';
import { installBackground } from '../../utils/job-harness';
import { booksHtml, installFakePage, NEXT_LINK } from '../../utils/fake-page';
import { usePanelMode } from '../../utils/panel-mode';
import * as workbench from '@/platform/workbench';

const PAGE_URL = 'http://127.0.0.1:3456/simple-grid.html';

/**
 * Reads storage while the panel is still on screen. The panel re-reads a running job every
 * second, so a bare await here would let it update outside React's act(); waitFor allows it.
 */
async function stored<T>(read: () => Promise<T>): Promise<T> {
  let value: T | undefined;
  await waitFor(async () => {
    value = await read();
  });
  return value as T;
}

/**
 * The whole simple flow (T1) with production code on every side: the panel, the real
 * background coordinator and router, and the real content workflow coordinator reading a
 * page of its own. Only the browser boundary is the Chrome mock. The background reaches the
 * page the way it does in Chrome, with a tab message.
 */
function installBackgroundThatReachesThePage() {
  const transport: JobTransport = {
    sendToTab: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
    broadcast: async () => undefined,
    openBlankTab: async () => 900,
    navigateTab: async () => undefined,
    getTabLoadStatus: async () => 'complete',
    injectContentScript: async () => ({ injected: false, url: PAGE_URL }),
  };
  return installBackground(db, { transport });
}

describe('App in simple mode: from one button to a saved Excel file (T1)', () => {
  beforeEach(async () => {
    await db.clearAllData();
    await usePanelMode('simple');
    installBackgroundThatReachesThePage();
    URL.createObjectURL = vi.fn(() => 'blob:pageharvest-test/1');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('collects the list and downloads it in four clicks, with no setting to understand', async () => {
    const user = userEvent.setup();
    installFakePage(booksHtml(20));
    const view = render(<App />);
    let clicks = 0;
    const click = async (name: string | RegExp) => {
      clicks += 1;
      await user.click(await screen.findByRole('button', { name }));
    };

    // 1. One button on the start screen opens List Setup.
    await click(/Find Data on This Page|Get the list on this page/i);
    await click(/Auto-detect on this page/i);

    // List is detected; "Found 20 items · N columns" shows and Start Extraction is enabled.
    await screen.findByText(/Found 20 items/);
    expect(
      screen.getByRole('button', { name: 'Start Extraction' })
    ).not.toBeDisabled();

    // 2. Start extraction.
    await click('Start Extraction');

    // 3. Done: the rows are in storage before the screen says so.
    expect(await screen.findByRole('heading', { name: 'Extraction complete' }, { timeout: 20000 })).toBeInTheDocument();
    const jobs = await stored(() => db.jobs.toArray());
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: 'COMPLETED', totalExtracted: 20 });
    expect(jobs[0].schema.pagination.type).toBe('none');
    const rows = await stored(() => db.records.where('datasetId').equals(jobs[0].datasetId as string).toArray());
    expect(rows).toHaveLength(20);
    expect(rows.map((row) => row.Title)).toContain('Book number 20');

    // The Done screen shows those same rows.
    const table = screen.getByRole('table', { name: 'Preview Snippet' });
    expect(within(table).getByText('Book number 1')).toBeInTheDocument();

    // 4. Download.
    await click(/Download for Excel/);
    await waitFor(() => expect(chromeMock.downloads.download).toHaveBeenCalledTimes(1));
    expect(chromeMock.downloads.download.mock.calls[0][0]).toMatchObject({ saveAs: false });
    expect(chromeMock.downloads.download.mock.calls[0][0].filename).toMatch(/\.xlsx$/);
    expect(await screen.findByText('File saved')).toBeInTheDocument();

    expect(clicks).toBe(4);

    // Nowhere on the way did the panel use a word from the code. "Recipes" is a real
    // navigation destination in the dock, so the check covers the technical nouns.
    expect(view.container.textContent).not.toMatch(/\bselectors?\b|\bschemas?\b|\bdatasets?\b|\bpagination\b|IndexedDB|confidence/i);
  }, 40000);

  it('offers more pages, already chosen, when the page has a Next link, and the job follows it', async () => {
    const user = userEvent.setup();
    installFakePage(booksHtml(20, NEXT_LINK));
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /Find Data on This Page|Get the list on this page/i }));
    await clickAutoDetect();

    await user.click(screen.getByRole('button', { name: 'Start Extraction' }));
    await waitFor(async () => expect(await db.jobs.count()).toBe(1), { timeout: 10000 });
    // What the user saw on screen is what the job was told to do: Next button, 5 pages at most.
    const [job] = await stored(() => db.jobs.toArray());
    expect(job.schema.pagination).toMatchObject({ type: 'next_button', maxPages: 5 });
    expect(job.schema.pagination.nextButtonSelector).toBeUndefined();

    // The first page's rows are saved while it runs, and stopping keeps them.
    expect(await screen.findByText('Live Extraction Stage')).toBeInTheDocument();
    await waitFor(async () => expect((await db.jobs.get(job.id))?.totalExtracted).toBe(20), { timeout: 10000 });
    await user.click(screen.getByRole('button', { name: 'Stop extraction' }));
    expect(await screen.findByRole('heading', { name: 'Extraction complete' }, { timeout: 20000 })).toBeInTheDocument();
    expect((await stored(() => db.jobs.get(job.id)))?.status).toBe('COMPLETED');
  }, 40000);

  it('uses the answer the user changed, not the one PageHarvest suggested', async () => {
    const user = userEvent.setup();
    installFakePage(booksHtml(20, NEXT_LINK));
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /Find Data on This Page|Get the list on this page/i }));
    await clickAutoDetect();
    await user.click(screen.getByRole('radio', { name: /This Page Only/i }));
    await user.click(screen.getByRole('button', { name: 'Start Extraction' }));

    expect(await screen.findByRole('heading', { name: 'Extraction complete' }, { timeout: 20000 })).toBeInTheDocument();
    const [job] = await stored(() => db.jobs.toArray());
    expect(job.schema.pagination.type).toBe('none');
    expect(job.pagesVisited).toBe(1);
  }, 40000);

  it('keeps a renamed column and leaves out an unticked one, all the way into storage', async () => {
    const user = userEvent.setup();
    installFakePage(booksHtml(20));
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /Find Data on This Page|Get the list on this page/i }));
    await clickAutoDetect();

    // Inline column editing in List Setup: expand it, rename Title → Book, untick Link.
    await user.click(screen.getByRole('button', { name: 'Edit columns' }));
    const title = await screen.findByRole('textbox', { name: 'Name of the column Title' });
    await user.clear(title);
    await user.type(title, 'Book{Enter}');
    await user.click(screen.getByRole('checkbox', { name: 'Keep the column Link' }));
    await user.click(screen.getByRole('button', { name: 'Start Extraction' }));

    expect(await screen.findByRole('heading', { name: 'Extraction complete' }, { timeout: 20000 })).toBeInTheDocument();
    const [job] = await stored(() => db.jobs.toArray());
    const names = job.schema.fields.map((field) => field.name);
    expect(names).toContain('Book');
    expect(names).not.toContain('Title');
    expect(names).not.toContain('Link');
    const [first] = await stored(() => db.records.where('datasetId').equals(job.datasetId as string).toArray());
    expect(first.Book).toMatch(/^Book number \d+$/);
    expect(first).not.toHaveProperty('Link');
  }, 40000);

  it('goes back from the columns to the list, and from the full table to the summary', async () => {
    const user = userEvent.setup();
    installFakePage(booksHtml(20));
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /Find Data on This Page|Get the list on this page/i }));
    await clickAutoDetect();
    await screen.findByText(/Found 20 items/);
    await user.click(screen.getByRole('button', { name: 'Re-pick' }));
    expect(await screen.findByText('Select a List Item')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await screen.findByText(/Found 20 items/);
    await user.click(screen.getByRole('button', { name: 'Start Extraction' }));
    await screen.findByRole('heading', { name: 'Extraction complete' }, { timeout: 20000 });

    const openSpy = vi.spyOn(workbench, 'openWorkbench').mockResolvedValue({ tabId: 1, reused: false });
    await user.click(screen.getByRole('button', { name: /View data & export/i }));
    expect(openSpy).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(await screen.findByRole('button', { name: /Find Data on This Page/i })).toBeInTheDocument();
  }, 40000);

  it('opens saved data from My data as a summary, and deletes it only after asking', async () => {
    const user = userEvent.setup();
    installFakePage(booksHtml(20));
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /Find Data on This Page|Get the list on this page/i }));
    await clickAutoDetect();
    await user.click(screen.getByRole('button', { name: 'Start Extraction' }));
    await screen.findByRole('heading', { name: 'Extraction complete' }, { timeout: 20000 });

    await user.click(screen.getByRole('button', { name: 'Data' }));
    expect(await screen.findByRole('heading', { name: 'My data' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Library sections' })).not.toBeInTheDocument();

    const [openButton] = await screen.findAllByRole('button', { name: /^Open / });
    await user.click(openButton);
    expect(await screen.findByText(/^20 rows from 127\.0\.0\.1, collected on /)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^Done/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Data' }));
    await user.click(await screen.findByRole('button', { name: /^Delete / }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Nothing saved yet')).toBeInTheDocument();
    expect(await stored(() => db.records.count())).toBe(0);
  }, 40000);
});

async function clickAutoDetect() {
  await userEvent.click(await screen.findByRole('button', { name: /Auto-detect on this page/i }));
}

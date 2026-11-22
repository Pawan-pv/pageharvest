import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../../entrypoints/sidepanel/App';
import type { JobTransport } from '@/background/job-coordinator';
import { db } from '@/storage/db';
import { installBackground } from '../../utils/job-harness';
import { booksHtml, installFakePage, NEXT_LINK } from '../../utils/fake-page';
import { usePanelMode } from '../../utils/panel-mode';

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

    // 1. One button on the start screen.
    await click(/Find Data on This Page|Get the list on this page/i);
    expect(await screen.findByRole('heading', { name: 'We found 20 items on this page' })).toBeInTheDocument();

    // 2. Is this it?
    await click('Yes, this is my list');
    expect(await screen.findByRole('heading', { name: 'Check your columns' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Steps' })).toHaveTextContent('Step 2 of 4: Check columns');
    await waitFor(() => expect(screen.getAllByRole('checkbox', { name: /^Keep the column / }).length).toBeGreaterThanOrEqual(2));
    // The page has no Next button, so the question is asked with "just this page" chosen.
    expect(screen.getByRole('radio', { name: 'No, just this page' })).toBeChecked();

    // 3. Start.
    await click('Start collecting');

    // 4. Done: the rows are in storage before the screen says so.
    expect(await screen.findByRole('heading', { name: 'Done. 20 rows collected' }, { timeout: 20000 })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Steps' })).toHaveTextContent('Step 4 of 4: Download');
    const jobs = await stored(() => db.jobs.toArray());
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: 'COMPLETED', totalExtracted: 20 });
    expect(jobs[0].schema.pagination.type).toBe('none');
    const rows = await stored(() => db.records.where('datasetId').equals(jobs[0].datasetId as string).toArray());
    expect(rows).toHaveLength(20);
    expect(rows.map((row) => row.Title)).toContain('Book number 20');

    // The Done screen shows those same rows.
    const table = screen.getByRole('table', { name: 'The first rows' });
    expect(within(table).getByText('Book number 1')).toBeInTheDocument();

    // 5. Download.
    await click('Download for Excel');
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
    await user.click(await screen.findByRole('button', { name: 'Yes, this is my list' }));

    const question = await screen.findByRole('group', { name: 'This list continues on more pages. Get them too?' });
    expect(within(question).getByRole('radio', { name: 'Yes, get more pages' })).toBeChecked();
    expect(within(question).getByRole('spinbutton', { name: 'Stop after this many pages:' })).toHaveValue(5);

    await user.click(screen.getByRole('button', { name: 'Start collecting' }));
    await waitFor(async () => expect(await db.jobs.count()).toBe(1), { timeout: 10000 });
    // What the user saw on screen is what the job was told to do: Next button, 5 pages at most.
    const [job] = await stored(() => db.jobs.toArray());
    expect(job.schema.pagination).toMatchObject({ type: 'next_button', maxPages: 5 });
    expect(job.schema.pagination.nextButtonSelector).toBeUndefined();

    // The first page's rows are saved while it runs, and stopping keeps them.
    expect(await screen.findByRole('heading', { name: 'Collecting your rows…' })).toBeInTheDocument();
    await waitFor(async () => expect((await db.jobs.get(job.id))?.totalExtracted).toBe(20), { timeout: 10000 });
    await user.click(screen.getByRole('button', { name: 'Stop here and keep my rows' }));
    expect(await screen.findByRole('heading', { name: 'Done. 20 rows collected' }, { timeout: 20000 })).toBeInTheDocument();
    expect((await stored(() => db.jobs.get(job.id)))?.status).toBe('COMPLETED');
  }, 40000);

  it('uses the answer the user changed, not the one PageHarvest suggested', async () => {
    const user = userEvent.setup();
    installFakePage(booksHtml(20, NEXT_LINK));
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /Find Data on This Page|Get the list on this page/i }));
    await user.click(await screen.findByRole('button', { name: 'Yes, this is my list' }));
    await user.click(await screen.findByRole('radio', { name: 'No, just this page' }));
    await user.click(screen.getByRole('button', { name: 'Start collecting' }));

    expect(await screen.findByRole('heading', { name: 'Done. 20 rows collected' }, { timeout: 20000 })).toBeInTheDocument();
    const [job] = await stored(() => db.jobs.toArray());
    expect(job.schema.pagination.type).toBe('none');
    expect(job.pagesVisited).toBe(1);
  }, 40000);

  it('keeps a renamed column and leaves out an unticked one, all the way into storage', async () => {
    const user = userEvent.setup();
    installFakePage(booksHtml(20));
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /Find Data on This Page|Get the list on this page/i }));
    await user.click(await screen.findByRole('button', { name: 'Yes, this is my list' }));

    const title = await screen.findByRole('textbox', { name: 'Name of the column Title' });
    await user.clear(title);
    await user.type(title, 'Book{Enter}');
    await user.click(screen.getByRole('checkbox', { name: 'Keep the column Link' }));
    await user.click(screen.getByRole('button', { name: 'Start collecting' }));

    expect(await screen.findByRole('heading', { name: 'Done. 20 rows collected' }, { timeout: 20000 })).toBeInTheDocument();
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
    await user.click(await screen.findByRole('button', { name: 'Yes, this is my list' }));
    await screen.findByRole('heading', { name: 'Check your columns' });
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { name: 'We found 20 items on this page' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Yes, this is my list' }));
    await user.click(await screen.findByRole('button', { name: 'Start collecting' }));
    await screen.findByRole('heading', { name: 'Done. 20 rows collected' }, { timeout: 20000 });

    await user.click(screen.getByRole('button', { name: 'See and change all rows' }));
    expect(await screen.findByRole('textbox', { name: 'Search these rows' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove Duplicates/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { name: 'Done. 20 rows collected' })).toBeInTheDocument();
  }, 40000);

  it('opens saved data from My data as a summary, and deletes it only after asking', async () => {
    const user = userEvent.setup();
    installFakePage(booksHtml(20));
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /Find Data on This Page|Get the list on this page/i }));
    await user.click(await screen.findByRole('button', { name: 'Yes, this is my list' }));
    await user.click(await screen.findByRole('button', { name: 'Start collecting' }));
    await screen.findByRole('heading', { name: 'Done. 20 rows collected' }, { timeout: 20000 });

    await user.click(screen.getByRole('button', { name: 'Data' }));
    expect(await screen.findByRole('heading', { name: 'My data' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Library sections' })).not.toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: /^Open / }));
    expect(await screen.findByText(/^20 rows from 127\.0\.0\.1, collected on /)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^Done/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Data' }));
    await user.click(await screen.findByRole('button', { name: /^Delete / }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Nothing saved yet')).toBeInTheDocument();
    expect(await stored(() => db.records.count())).toBe(0);
  }, 40000);
});

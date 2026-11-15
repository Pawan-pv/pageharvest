import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../entrypoints/sidepanel/App';
import type { JobTransport } from '@/background/job-coordinator';
import { messagingService } from '@/services/messaging';
import { db } from '@/storage/db';
import { installBackground } from '../utils/job-harness';
import { booksHtml, installFakePage } from '../utils/fake-page';
import { usePanelMode } from '../utils/panel-mode';

const PAGE_URL = 'http://127.0.0.1:3456/simple-grid.html';

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

async function reachStart(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Get the list on this page' }));
  await user.click(await screen.findByRole('button', { name: 'Yes, this is my list' }));
  expect(await screen.findByRole('heading', { name: 'Check your columns' })).toBeInTheDocument();
  await waitFor(() => expect(screen.getAllByRole('checkbox', { name: /^Keep the column / }).length).toBeGreaterThanOrEqual(2));
}

/**
 * The panel waits 20 s for START_JOB. The background can take longer, for example when the
 * page is slow to accept the script, and then the job is running although the panel's
 * request timed out. The panel must look at storage before it calls the start a failure.
 */
describe('A start that outlasts the panel timeout', () => {
  beforeEach(async () => {
    await db.clearAllData();
    await usePanelMode('simple');
    installBackgroundThatReachesThePage();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('follows the job the background started, and shows no error', async () => {
    const user = userEvent.setup();
    installFakePage(booksHtml(20));
    const startJob = messagingService.startJob.bind(messagingService);
    vi.spyOn(messagingService, 'startJob').mockImplementation(async (request) => {
      // The background really starts the job; only the reply is lost to the timeout.
      await startJob(request);
      throw new Error('Message timeout after 20000ms');
    });
    render(<App />);
    await reachStart(user);

    await user.click(screen.getByRole('button', { name: 'Start collecting' }));

    expect(await screen.findByRole('heading', { name: 'Done. 20 rows collected' }, { timeout: 20000 })).toBeInTheDocument();
    expect(screen.queryByText(/Message timeout/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Check your columns' })).not.toBeInTheDocument();
    expect(await db.jobs.count()).toBe(1);
  });

  it('follows the running job when the retried request is refused as "already running"', async () => {
    const user = userEvent.setup();
    installFakePage(booksHtml(20));
    const startJob = messagingService.startJob.bind(messagingService);
    vi.spyOn(messagingService, 'startJob').mockImplementation(async (request) => {
      await startJob(request);
      throw new Error('An extraction is already running in this tab.');
    });
    render(<App />);
    await reachStart(user);

    await user.click(screen.getByRole('button', { name: 'Start collecting' }));

    expect(await screen.findByRole('heading', { name: 'Done. 20 rows collected' }, { timeout: 20000 })).toBeInTheDocument();
    expect(screen.queryByText(/already running/)).not.toBeInTheDocument();
  });

  it('still reports a start that really failed, with nothing stored', async () => {
    const user = userEvent.setup();
    installFakePage(booksHtml(20));
    vi.spyOn(messagingService, 'startJob').mockRejectedValue(new Error('Message timeout after 20000ms'));
    render(<App />);
    await reachStart(user);

    await user.click(screen.getByRole('button', { name: 'Start collecting' }));

    expect(await screen.findByText(/Message timeout after 20000ms/, undefined, { timeout: 15000 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Check your columns' })).toBeInTheDocument();
    expect(await db.jobs.count()).toBe(0);
  });

  it('ignores an older job of the same tab', async () => {
    const user = userEvent.setup();
    installFakePage(booksHtml(20));
    render(<App />);
    await reachStart(user);
    // A job this tab ran earlier, before the click.
    await db.jobs.put({
      id: 'job_earlier',
      tabId: 101,
      targetUrl: PAGE_URL,
      status: 'COMPLETED',
      startedAt: Date.now() - 60_000,
      updatedAt: Date.now() - 60_000,
    } as never);
    vi.spyOn(messagingService, 'startJob').mockRejectedValue(new Error('Message timeout after 20000ms'));

    await user.click(screen.getByRole('button', { name: 'Start collecting' }));

    expect(await screen.findByText(/Message timeout after 20000ms/, undefined, { timeout: 15000 })).toBeInTheDocument();
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { GUIDE_STORAGE_KEY } from '@/components/guide/preferences';
import { CONSENT_STORAGE_KEY } from '@/components/consent/consent';
import { usePanelMode } from '../utils/panel-mode';
import { createChromeMock, ChromeMock } from '../utils/chrome-mock';
import App from '~/entrypoints/sidepanel/App';

describe('Side Panel UI Shell (App.tsx)', () => {
  let mockChrome: ChromeMock;

  beforeEach(async () => {
    mockChrome = (globalThis as unknown as { chromeMock?: ChromeMock }).chromeMock ?? createChromeMock();
    mockChrome.reset();
    await mockChrome.storage.local.set({
      [GUIDE_STORAGE_KEY]: { version: 1, onboardingDone: true },
      [CONSENT_STORAGE_KEY]: { accepted: true, version: '1.0', acceptedAt: new Date().toISOString() },
    });
    await usePanelMode('advanced');
    Reflect.set(globalThis, 'chrome', mockChrome);
  });

  it('renders the PageHarvest header and active tab information', async () => {
    mockChrome.activeTab = {
      id: 101,
      index: 0,
      windowId: 1,
      highlighted: true,
      active: true,
      pinned: false,
      incognito: false,
      frozen: false,
      selected: true,
      discarded: false,
      autoDiscardable: true,
      groupId: -1,
      status: 'complete',
      url: 'https://books.toscrape.com/catalogue',
      title: 'Books to Scrape'
    };

    render(<App />);

    expect(await screen.findByRole('heading', { level: 1, name: /PageHarvest/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/Books to Scrape/i)).toBeInTheDocument();
      expect(screen.getByText(/books\.toscrape\.com/i)).toBeInTheDocument();
    });
  });

  it('displays warning badge when active tab is restricted (e.g. chrome://)', async () => {
    mockChrome.activeTab = {
      id: 102,
      index: 0,
      windowId: 1,
      highlighted: true,
      active: true,
      pinned: false,
      incognito: false,
      frozen: false,
      selected: true,
      discarded: false,
      autoDiscardable: true,
      groupId: -1,
      status: 'complete',
      url: 'chrome://settings',
      title: 'Settings'
    };

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Can't read this page/i)).toBeInTheDocument();
    });
  });

  it('shows connection status badge', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Ready|Can't read this page/i)).toBeInTheDocument();
    });
  });

  it('provides action buttons for Element Picker and Detection', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Pick items myself/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Find data automatically/i })).toBeInTheDocument();
    });
  });
});

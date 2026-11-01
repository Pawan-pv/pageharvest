import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createChromeMock, ChromeMock } from '../utils/chrome-mock';
import App from '~/entrypoints/sidepanel/App';

describe('Side Panel UI Shell (App.tsx)', () => {
  let mockChrome: ChromeMock;

  beforeEach(() => {
    mockChrome = createChromeMock();
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

    expect(screen.getByRole('heading', { level: 1, name: /PageHarvest/i })).toBeInTheDocument();
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
      expect(screen.getByText(/Restricted/i)).toBeInTheDocument();
    });
  });

  it('shows connection status badge', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Ready|Restricted/i)).toBeInTheDocument();
    });
  });

  it('provides action buttons for Element Picker and Detection', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Select Elements/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Auto-Detect Lists/i })).toBeInTheDocument();
    });
  });
});

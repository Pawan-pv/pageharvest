import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createChromeMock, ChromeMock } from '../utils/chrome-mock';
import App from '@/entrypoints/sidepanel/App';

describe('Side Panel UI Shell (App.tsx)', () => {
  let mockChrome: ChromeMock;

  beforeEach(() => {
    mockChrome = createChromeMock();
    (globalThis as any).chrome = mockChrome;
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
      status: 'complete',
      url: 'https://books.toscrape.com/catalogue',
      title: 'Books to Scrape'
    };

    render(<App />);

    expect(screen.getByText(/PageHarvest/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/Books to Scrape/i)).toBeInTheDocument();
      expect(screen.getByText(/https:\/\/books\.toscrape\.com/i)).toBeInTheDocument();
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
      status: 'complete',
      url: 'chrome://settings',
      title: 'Settings'
    };

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Restricted Page/i)).toBeInTheDocument();
    });
  });

  it('shows connection status badge', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Connected|Ready/i)).toBeInTheDocument();
    });
  });

  it('provides action buttons for Element Picker and Detection', async () => {
    render(<App />);

    expect(screen.getByRole('button', { name: /Start Picker|Inspect/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Auto-Detect|Detect/i })).toBeInTheDocument();
  });
});

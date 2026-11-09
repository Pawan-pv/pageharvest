import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WebsiteCard } from '@/components/dashboard/WebsiteCard';
import { QuickActions } from '@/components/dashboard/QuickActions';
import { RecentProjectsCard } from '@/components/dashboard/RecentProjectsCard';
import { MainDashboard } from '@/components/dashboard/MainDashboard';
import { TabInfo } from '@/services/messaging';
import { Dataset } from '@/types';

describe('UI: Main Dashboard & Website Detection', () => {
  const mockInjectableTab: TabInfo = {
    id: 101,
    url: 'https://books.toscrape.com/catalogue/category/books_1/index.html',
    title: 'All Products | Books to Scrape',
    favIconUrl: 'https://books.toscrape.com/favicon.ico',
    isInjectable: true,
  };

  const mockRestrictedTab: TabInfo = {
    id: 102,
    url: 'chrome://extensions/',
    title: 'Extensions',
    isInjectable: false,
  };

  it('renders WebsiteCard with hostname, title and Ready badge for injectable web page', () => {
    const onRefresh = vi.fn();
    render(<WebsiteCard tab={mockInjectableTab} onRefresh={onRefresh} />);

    expect(screen.getByText('books.toscrape.com')).toBeInTheDocument();
    expect(screen.getByText(/All Products \| Books to Scrape/)).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();

    // Refresh button works
    const refreshBtn = screen.getByRole('button', { name: /refresh active tab/i });
    fireEvent.click(refreshBtn);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('renders Restricted badge and warning notice for internal chrome:// pages', () => {
    render(<WebsiteCard tab={mockRestrictedTab} onRefresh={vi.fn()} />);

    expect(screen.getByText('Restricted')).toBeInTheDocument();
    expect(
      screen.getByText(/PageHarvest cannot read browser pages like this one/i)
    ).toBeInTheDocument();
  });

  it('asks for the toolbar click, not "browser page", when Chrome hides the address', () => {
    render(
      <WebsiteCard tab={{ id: 103, url: '', title: 'This page', isInjectable: false, needsAccess: true }} onRefresh={vi.fn()} />
    );

    expect(screen.getByText('Access needed')).toBeInTheDocument();
    expect(screen.getByText(/PageHarvest cannot see this page yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Click the PageHarvest button in the Chrome toolbar/i)).toBeInTheDocument();
    expect(screen.queryByText('Restricted')).not.toBeInTheDocument();
    expect(screen.queryByText(/cannot read browser pages like this one/i)).not.toBeInTheDocument();
  });

  it('triggers quick actions on user click', () => {
    const onSelectElements = vi.fn();
    const onAutoDetectLists = vi.fn();
    const onExtractTable = vi.fn();
    const onExtractLinks = vi.fn();

    render(
      <QuickActions
        onSelectElements={onSelectElements}
        onAutoDetectLists={onAutoDetectLists}
        onExtractTable={onExtractTable}
        onExtractLinks={onExtractLinks}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Pick items myself' }));
    expect(onSelectElements).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Find data automatically' }));
    expect(onAutoDetectLists).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('More ways to start'));
    fireEvent.click(screen.getByRole('button', { name: 'Extract a table' }));
    expect(onExtractTable).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Extract all links' }));
    expect(onExtractLinks).toHaveBeenCalledTimes(1);
  });

  it('disables quick actions when disabled prop is true (e.g. restricted tab)', () => {
    render(
      <QuickActions
        disabled={true}
        onSelectElements={vi.fn()}
        onAutoDetectLists={vi.fn()}
        onExtractTable={vi.fn()}
        onExtractLinks={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Pick items myself' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Find data automatically' })).toBeDisabled();
    expect(screen.getByText(/Open a normal website tab to start/)).toBeInTheDocument();
  });

  it('tells the user to click the toolbar button when the page is not shared yet', () => {
    render(
      <MainDashboard
        tab={{ id: 9, url: '', title: 'This page', isInjectable: false, needsAccess: true }}
        isTabLoading={false}
        onRefreshTab={vi.fn()}
        onSelectElements={vi.fn()}
        onAutoDetectLists={vi.fn()}
        onExtractTable={vi.fn()}
        onExtractLinks={vi.fn()}
        datasets={[]}
        isDatasetsLoading={false}
        onViewDataset={vi.fn()}
        onViewAllHistory={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Find data automatically' })).toBeDisabled();
    expect(screen.getByText(/Click the PageHarvest button in the Chrome toolbar to start/)).toBeInTheDocument();
    expect(screen.queryByText(/Open a normal website tab to start/)).not.toBeInTheDocument();
  });

  it('renders RecentProjectsCard with dataset list and calls onViewDataset', () => {
    const mockDatasets: Dataset[] = [
      {
        id: 'ds-1',
        name: 'Amazon Laptops',
        url: 'https://amazon.com/laptops',
        recordsCount: 48,
        fields: [{ id: 'f1', name: 'Title', selector: 'h2', extractor: 'text' }],
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      },
    ];

    const onViewDataset = vi.fn();
    const onViewAll = vi.fn();

    render(
      <RecentProjectsCard
        datasets={mockDatasets}
        onViewDataset={onViewDataset}
        onViewAllHistory={onViewAll}
      />
    );

    expect(screen.getByText('Amazon Laptops')).toBeInTheDocument();
    expect(screen.getByText('48 rows')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Amazon Laptops'));
    expect(onViewDataset).toHaveBeenCalledWith(mockDatasets[0]);

    fireEvent.click(screen.getByText(/View all/i));
    expect(onViewAll).toHaveBeenCalledTimes(1);
  });

  it('renders empty state in RecentProjectsCard when no datasets exist', () => {
    render(
      <RecentProjectsCard
        datasets={[]}
        onViewDataset={vi.fn()}
        onViewAllHistory={vi.fn()}
      />
    );

    expect(screen.getByText('No recent extractions')).toBeInTheDocument();
  });

  it('renders the complete MainDashboard layout', () => {
    render(
      <MainDashboard
        tab={mockInjectableTab}
        onRefreshTab={vi.fn()}
        datasets={[]}
        onSelectElements={vi.fn()}
        onAutoDetectLists={vi.fn()}
        onExtractTable={vi.fn()}
        onExtractLinks={vi.fn()}
        onViewDataset={vi.fn()}
        onViewAllHistory={vi.fn()}
      />
    );

    expect(screen.getByText('books.toscrape.com')).toBeInTheDocument();
    expect(screen.getByText('Get data from this page')).toBeInTheDocument();
    expect(screen.getByText(/Everything PageHarvest collects stays on this computer/)).toBeInTheDocument();
    expect(screen.getByText('Recent Extractions')).toBeInTheDocument();
  });
});

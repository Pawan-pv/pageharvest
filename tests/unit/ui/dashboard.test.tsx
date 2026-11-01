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
      screen.getByText(/Chrome extensions cannot inspect browser internal pages/i)
    ).toBeInTheDocument();
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

    fireEvent.click(screen.getByText('Select Elements'));
    expect(onSelectElements).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Auto-Detect Lists'));
    expect(onAutoDetectLists).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Extract Tables'));
    expect(onExtractTable).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Extract Links'));
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

    const selectBtn = screen.getByText('Select Elements').closest('button');
    expect(selectBtn).toBeDisabled();
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
    expect(screen.getByText('Quick Actions')).toBeInTheDocument();
    expect(screen.getByText('What can be extracted?')).toBeInTheDocument();
    expect(screen.getByText('Recent Extractions')).toBeInTheDocument();
  });
});

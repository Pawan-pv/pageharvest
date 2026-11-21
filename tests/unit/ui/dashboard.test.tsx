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
    render(<WebsiteCard advanced tab={mockInjectableTab} onRefresh={onRefresh} />);

    expect(screen.getByText('books.toscrape.com')).toBeInTheDocument();
    expect(screen.getByText(/All Products \| Books to Scrape/)).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();

    // Refresh button works
    const refreshBtn = screen.getByRole('button', { name: 'Check this page again' });
    fireEvent.click(refreshBtn);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('never loads the site icon: the panel makes no network request of its own', () => {
    // What Chrome reports for a tab includes the address of the site's icon.
    const tabWithIcon = { ...mockInjectableTab, favIconUrl: 'https://books.toscrape.com/favicon.ico' };
    const { container } = render(<WebsiteCard advanced tab={tabWithIcon} onRefresh={vi.fn()} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toContain('favicon.ico');
  });

  it('has no refresh button in simple mode, because the panel follows the tab by itself', () => {
    render(<WebsiteCard tab={mockInjectableTab} onRefresh={vi.fn()} />);
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check this page again' })).not.toBeInTheDocument();
  });

  it('tells the user to switch tabs, not to press a button, on a page it cannot read', () => {
    render(<WebsiteCard tab={mockRestrictedTab} onRefresh={vi.fn()} />);
    expect(screen.getByText(/Switch to a tab with a website/)).toBeInTheDocument();
    expect(screen.queryByText(/press Refresh/i)).not.toBeInTheDocument();
  });

  it('renders the cannot-read badge and warning notice for internal chrome:// pages', () => {
    render(<WebsiteCard tab={mockRestrictedTab} onRefresh={vi.fn()} />);

    expect(screen.getByText("Can't read this page")).toBeInTheDocument();
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
    // Since ADR-040 this happens only when the user limited site access in Chrome, and it says so.
    expect(screen.getByText(/limited in Chrome's settings/i)).toBeInTheDocument();
    expect(screen.getByText(/Click the PageHarvest button in the Chrome toolbar/i)).toBeInTheDocument();
    expect(screen.queryByText("Can't read this page")).not.toBeInTheDocument();
    expect(screen.queryByText(/cannot read browser pages like this one/i)).not.toBeInTheDocument();
  });

  it('triggers quick actions on user click', () => {
    const onSelectElements = vi.fn();
    const onAutoDetectLists = vi.fn();
    const onExtractTable = vi.fn();
    const onExtractLinks = vi.fn();

    render(
      <QuickActions
        advanced
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

    expect(screen.getByText('Quick presets')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Table|Extract a table/ }));
    expect(onExtractTable).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Links|Extract all links/ }));
    expect(onExtractLinks).toHaveBeenCalledTimes(1);
  });

  it('disables quick actions when disabled prop is true (e.g. restricted tab)', () => {
    render(
      <QuickActions
        advanced
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
        advanced
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

  it('says once, not twice, what to do on a page it cannot read, and offers nothing that cannot work', () => {
    render(
      <MainDashboard
        tab={mockRestrictedTab}
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
    // The card explains the page; the start section does not repeat it.
    expect(screen.getAllByText(/Switch to a tab with a website/)).toHaveLength(1);
    expect(screen.queryByText(/Open a normal website tab to start/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Find Data on This Page|Get the list on this page/i })).toBeDisabled();
    expect(screen.queryByText(/Quick presets|More ways to start/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pick one item myself' })).not.toBeInTheDocument();
  });

  it('shows no empty "recent data" box in simple mode before anything is saved', () => {
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
    expect(screen.queryByText('My recent data')).not.toBeInTheDocument();
    expect(screen.queryByText('Nothing saved yet')).not.toBeInTheDocument();
    expect(screen.getByText(/Everything it collects stays on this computer/)).toBeInTheDocument();
  });

  // The store's prominent-disclosure rule (User Data FAQ 10) wants the panel itself to say
  // what is read and where it is kept, before the first page is read.
  it.each([false, true])('says what it reads and where it keeps it, before anything is read (advanced: %s)', (advanced) => {
    render(
      <MainDashboard
        advanced={advanced}
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
    const note = screen.getByText(/PageHarvest reads only the page you ask it to/);
    expect(note).toHaveTextContent(
      'PageHarvest reads only the page you ask it to: its text, links, image addresses and page address. Everything it collects stays on this computer, and nothing is sent anywhere.'
    );
  });

  it('renders empty state in RecentProjectsCard when no datasets exist', () => {
    render(
      <RecentProjectsCard
        datasets={[]}
        onViewDataset={vi.fn()}
        onViewAllHistory={vi.fn()}
      />
    );

    expect(screen.getByText('Nothing saved yet')).toBeInTheDocument();
  });

  it('renders the complete MainDashboard layout', () => {
    render(
      <MainDashboard
        advanced
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
    expect(screen.getByText(/Everything it collects stays on this computer/)).toBeInTheDocument();
    expect(screen.getByText('My recent data')).toBeInTheDocument();
  });
});

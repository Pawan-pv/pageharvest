import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WebsiteCard } from '@/components/dashboard/WebsiteCard';
import { ToolHub } from '@/components/dashboard/ToolHub';
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
});

describe('UI: Tool Hub', () => {
  const renderHub = (props: Partial<React.ComponentProps<typeof ToolHub>> = {}) => {
    const handlers = {
      onAutoDetectLists: vi.fn(),
      onExtractTable: vi.fn(),
      onExtractLinks: vi.fn(),
      onOpenPageExtractor: vi.fn(),
      onOpenSitemapExplorer: vi.fn(),
      onOpenShopifyExtractor: vi.fn(),
      onViewAllHistory: vi.fn(),
    };
    render(<ToolHub datasetsCount={0} {...handlers} {...props} />);
    return handlers;
  };

  it('runs the live extractors from their cards', () => {
    const handlers = renderHub();

    fireEvent.click(screen.getByRole('button', { name: 'Find Data on This Page' }));
    expect(handlers.onAutoDetectLists).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Extract a table' }));
    expect(handlers.onExtractTable).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Extract all links' }));
    expect(handlers.onExtractLinks).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Page Extractor' }));
    expect(handlers.onOpenPageExtractor).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Sitemap Explorer' }));
    expect(handlers.onOpenSitemapExplorer).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Shopify Extractor' }));
    expect(handlers.onOpenShopifyExtractor).toHaveBeenCalledTimes(1);

    expect(screen.getByRole('heading', { name: /Tools/i })).toBeInTheDocument();
    expect(screen.getByText('List Extractor')).toBeInTheDocument();
    expect(screen.getByText('Table Extractor')).toBeInTheDocument();
    expect(screen.getByText('Links Extractor')).toBeInTheDocument();
    expect(screen.getByText('Page Extractor')).toBeInTheDocument();
    expect(screen.getByText('Sitemap Explorer')).toBeInTheDocument();
    expect(screen.getByText('Shopify Extractor')).toBeInTheDocument();
  });

  it('shows the recent-data count and opens the Data view', () => {
    const handlers = renderHub({ datasetsCount: 3 });

    const recent = screen.getByRole('button', { name: /My Recent \(3\)/ });
    fireEvent.click(recent);
    expect(handlers.onViewAllHistory).toHaveBeenCalledTimes(1);
  });

  it('disables page-bound live extractors when the page cannot be read', () => {
    renderHub({ disabled: true });

    expect(screen.getByRole('button', { name: 'Find Data on This Page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Extract a table' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Extract all links' })).toBeDisabled();
  });

  it.each([
    'Image Downloader',
    'Email Extractor',
    'Social Link Extractor',
    'Page Text Extractor',
  ])('previews the roadmap tool %s as disabled and badged', (name) => {
    renderHub();

    const card = screen.getByRole('button', { name });
    expect(card).toBeDisabled();
    expect(screen.getByText('v2.0 suite')).toBeInTheDocument();
    expect(screen.getAllByText('Coming Soon').length).toBeGreaterThan(0);
  });
});

describe('UI: MainDashboard', () => {
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

  it('renders the tool hub and the prominent data disclosure, not the old hero', () => {
    render(
      <MainDashboard
        datasets={mockDatasets}
        onAutoDetectLists={vi.fn()}
        onExtractTable={vi.fn()}
        onExtractLinks={vi.fn()}
        onViewAllHistory={vi.fn()}
      />
    );

    expect(screen.getByText('List Extractor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /My Recent \(1\)/ })).toBeInTheDocument();
    expect(screen.getByText(/Everything it collects stays on this computer/)).toBeInTheDocument();
    expect(screen.queryByText('Get data from this page')).not.toBeInTheDocument();
    expect(screen.queryByText('Quick presets')).not.toBeInTheDocument();
  });

  it('switches every live tool off when the page cannot be read', () => {
    render(
      <MainDashboard
        datasets={[]}
        disabled
        onAutoDetectLists={vi.fn()}
        onExtractTable={vi.fn()}
        onExtractLinks={vi.fn()}
        onViewAllHistory={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Find Data on This Page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Extract a table' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Extract all links' })).toBeDisabled();
  });

  // The store's prominent-disclosure rule (User Data FAQ 10) wants the panel itself to say
  // what is read and where it is kept, before the first page is read.
  it('says what it reads and where it keeps it, before anything is read', () => {
    render(
      <MainDashboard
        datasets={[]}
        onAutoDetectLists={vi.fn()}
        onExtractTable={vi.fn()}
        onExtractLinks={vi.fn()}
        onViewAllHistory={vi.fn()}
      />
    );
    const note = screen.getByText(/PageHarvest reads only the page you ask it to/);
    expect(note).toHaveTextContent(
      'PageHarvest reads only the page you ask it to: its text, links, image addresses and page address. Everything it collects stays on this computer, and nothing is sent anywhere.'
    );
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WebsiteCard } from '@/components/dashboard/WebsiteCard';
import { MainDashboard } from '@/components/dashboard/MainDashboard';
import { ExportDialog } from '@/components/grid/ExportDialog';
import { TabInfo } from '@/services/messaging';
import { Dataset, ExtractedRecord, FieldDefinition } from '@/types';
import * as shopifyDetector from '@/core/shopify/detector';

describe('UI: Tool Hub Routing & Shopify Integration', () => {
  const mockTab: TabInfo = {
    id: 101,
    url: 'https://shop.example.com/products',
    title: 'Example Store',
    isInjectable: true,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does not make passive network requests or probe Shopify on WebsiteCard mount', async () => {
    const detectSpy = vi.spyOn(shopifyDetector, 'detectShopifyStore');

    render(
      <WebsiteCard
        tab={mockTab}
        onRefresh={vi.fn()}
      />
    );

    expect(detectSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Shopify store detected/i })).not.toBeInTheDocument();
  });

  it('wires all tool open callbacks from MainDashboard down to ToolHub', () => {
    const onOpenPage = vi.fn();
    const onOpenSitemap = vi.fn();
    const onOpenShopify = vi.fn();
    const onOpenEmail = vi.fn();
    const onOpenSocial = vi.fn();
    const onOpenPageText = vi.fn();
    const onOpenImages = vi.fn();

    render(
      <MainDashboard
        datasets={[]}
        onAutoDetectLists={vi.fn()}
        onExtractTable={vi.fn()}
        onExtractLinks={vi.fn()}
        onOpenPageExtractor={onOpenPage}
        onOpenSitemapExplorer={onOpenSitemap}
        onOpenShopifyExtractor={onOpenShopify}
        onOpenEmailExtractor={onOpenEmail}
        onOpenSocialExtractor={onOpenSocial}
        onOpenPageTextExtractor={onOpenPageText}
        onOpenImageDownloader={onOpenImages}
        onViewAllHistory={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Page Extractor' }));
    expect(onOpenPage).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Sitemap Explorer' }));
    expect(onOpenSitemap).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Shopify Extractor' }));
    expect(onOpenShopify).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Email Extractor' }));
    expect(onOpenEmail).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Social Link Extractor' }));
    expect(onOpenSocial).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Page Text Extractor' }));
    expect(onOpenPageText).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Image Downloader' }));
    expect(onOpenImages).toHaveBeenCalledTimes(1);
  });

  it('provides Shopify Admin CSV export format in ExportDialog', () => {
    const mockDataset: Dataset = {
      id: 'ds-shopify-1',
      name: 'Shopify Products',
      url: 'https://myshop.com/products.json',
      recordsCount: 5,
      fields: [
        { id: 'f1', name: 'Handle', selector: 'handle', extractor: 'text' },
        { id: 'f2', name: 'Title', selector: 'title', extractor: 'text' },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const mockRecords: ExtractedRecord[] = [
      { _id: '1', _page: 1, _extractedAt: Date.now(), Handle: 'cool-tshirt', Title: 'Cool T-Shirt' },
    ];

    const mockFields: FieldDefinition[] = mockDataset.fields;

    render(
      <ExportDialog
        isOpen={true}
        onClose={vi.fn()}
        dataset={mockDataset}
        records={mockRecords}
        fields={mockFields}
      />
    );

    // Should list Shopify Import CSV format option
    expect(screen.getByText(/Shopify Import CSV/i)).toBeInTheDocument();
    // And it is selected by default for shopify URLs
    expect(screen.getByText(/Formatted for direct import into Shopify Admin products/i)).toBeInTheDocument();
  });
});

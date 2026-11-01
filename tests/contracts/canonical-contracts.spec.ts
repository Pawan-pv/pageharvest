import { describe, it, expect } from 'vitest';
import {
  ExtractionFieldSchema,
  PaginationConfigSchema,
  ExtractionSchemaSchema,
  ExtractionProjectSchema,
  ExtractionRecordSchema,
  DetectedListSchema,
  ExtractionJobSchema,
  ExtractionProgressSchema,
  ExtractionErrorSchema,
  BrowserMessageSchema,
  ExportConfigSchema,
} from '@/shared/contracts';

describe('PageHarvest Canonical Shared Contracts', () => {
  it('validates ExtractionFieldSchema with default transform', () => {
    const field = {
      id: 'field-title',
      name: 'Product Name',
      selector: 'h1.product-title',
      extractor: 'text' as const,
      required: true,
    };
    const parsed = ExtractionFieldSchema.parse(field);
    expect(parsed.id).toBe('field-title');
    expect(parsed.extractor).toBe('text');
    expect(parsed.transform).toBe('trim');
  });

  it('enforces attributeName presence when extractor is attribute', () => {
    const invalid = {
      id: 'field-attr',
      name: 'SKU',
      selector: 'div.sku-box',
      extractor: 'attribute' as const,
    };
    expect(() => ExtractionFieldSchema.parse(invalid)).toThrow();

    const valid = {
      ...invalid,
      attributeName: 'data-sku',
    };
    const parsed = ExtractionFieldSchema.parse(valid);
    expect(parsed.attributeName).toBe('data-sku');
  });

  it('validates PaginationConfigSchema with defaults', () => {
    const config = {
      type: 'next_button' as const,
      nextButtonSelector: 'a.next-page',
    };
    const parsed = PaginationConfigSchema.parse(config);
    expect(parsed.type).toBe('next_button');
    expect(parsed.maxPages).toBe(20);
    expect(parsed.delayMs).toBe(1500);
    expect(parsed.scrollCount).toBe(30);
    expect(parsed.stopCondition).toBe('no_new_records');
  });

  it('validates ExtractionSchemaSchema with nested fields', () => {
    const schema = {
      id: 'schema-ecom-1',
      name: 'Amazon Products',
      urlPattern: 'https://amazon.com/s/*',
      containerSelector: 'div[data-component-type="s-search-result"]',
      fields: [
        {
          id: 'f-title',
          name: 'Title',
          selector: 'h2 a span',
          extractor: 'text' as const,
        },
        {
          id: 'f-link',
          name: 'URL',
          selector: 'h2 a',
          extractor: 'href' as const,
        },
      ],
      pagination: {
        type: 'next_button' as const,
        nextButtonSelector: 'a.s-pagination-next',
      },
    };
    const parsed = ExtractionSchemaSchema.parse(schema);
    expect(parsed.fields).toHaveLength(2);
    expect(parsed.version).toBe(1);
    expect(parsed.createdAt).toBeGreaterThan(0);
  });

  it('validates ExtractionProjectSchema', () => {
    const project = {
      id: 'proj-001',
      name: 'Electronics Scraping Project',
      targetUrl: 'https://example.com/shop',
      schema: {
        id: 'schema-001',
        name: 'Shop Items',
        urlPattern: 'https://example.com/shop*',
        containerSelector: '.item-card',
        fields: [
          {
            id: 'f1',
            name: 'Price',
            selector: '.price',
            extractor: 'number' as const,
          },
        ],
      },
      status: 'configured' as const,
    };
    const parsed = ExtractionProjectSchema.parse(project);
    expect(parsed.status).toBe('configured');
    expect(parsed.targetUrl).toBe('https://example.com/shop');
  });

  it('validates ExtractionRecordSchema with dynamic properties and metadata', () => {
    const record = {
      _id: 'rec-uuid-1',
      _page: 2,
      _extractedAt: 1700000000,
      _sourceUrl: 'https://example.com/shop?page=2',
      _hash: 'abc123hash',
      title: 'Wireless Mouse',
      price: 29.99,
      inStock: true,
      dimensions: null,
    };
    const parsed = ExtractionRecordSchema.parse(record);
    expect(parsed._id).toBe('rec-uuid-1');
    expect(parsed._page).toBe(2);
    expect(parsed['title']).toBe('Wireless Mouse');
    expect(parsed['price']).toBe(29.99);
    expect(parsed['inStock']).toBe(true);
  });

  it('validates DetectedListSchema', () => {
    const list = {
      containerSelector: 'ul.product-grid > li',
      itemCount: 24,
      sampleItems: [
        {
          tag: 'LI',
          previewText: 'Product 1 Preview',
          classes: ['grid-item', 'active'],
          attributes: { 'data-id': 'p1' },
        },
      ],
      suggestedFields: [
        {
          id: 'f-sugg-1',
          name: 'title',
          selector: 'h3',
          extractor: 'text' as const,
        },
      ],
      confidence: 0.95,
      boundingBox: { top: 100, left: 50, width: 800, height: 1200 },
    };
    const parsed = DetectedListSchema.parse(list);
    expect(parsed.confidence).toBe(0.95);
    expect(parsed.itemCount).toBe(24);
  });

  it('validates ExtractionJobSchema', () => {
    const job = {
      id: 'job-run-101',
      projectId: 'proj-001',
      targetUrl: 'https://example.com/shop',
      schema: {
        id: 's1',
        name: 'S1',
        urlPattern: '*',
        containerSelector: '.item',
        fields: [{ id: 'f1', name: 'Name', selector: 'span', extractor: 'text' as const }],
      },
      status: 'RUNNING' as const,
      totalExtracted: 150,
      duplicatesSkipped: 12,
      pagesVisited: 5,
    };
    const parsed = ExtractionJobSchema.parse(job);
    expect(parsed.status).toBe('RUNNING');
    expect(parsed.totalExtracted).toBe(150);
  });

  it('validates ExtractionProgressSchema', () => {
    const progress = {
      jobId: 'job-run-101',
      status: 'RUNNING' as const,
      progressKind: 'pages' as const,
      currentStep: 3,
      targetSteps: 10,
      recordsExtracted: 90,
      duplicatesCount: 2,
    };
    const parsed = ExtractionProgressSchema.parse(progress);
    expect(parsed.currentStep).toBe(3);
    expect(parsed.recordsExtracted).toBe(90);
  });

  it('validates ExtractionErrorSchema', () => {
    const err = {
      code: 'CONTAINER_NOT_FOUND' as const,
      message: 'Specified container selector div.product-card was not found in the DOM.',
      jobId: 'job-run-101',
      pageNumber: 1,
      selector: 'div.product-card',
      recoverable: false,
    };
    const parsed = ExtractionErrorSchema.parse(err);
    expect(parsed.code).toBe('CONTAINER_NOT_FOUND');
    expect(parsed.recoverable).toBe(false);
  });

  it('validates discriminated BrowserMessageSchema across command variants', () => {
    const envelope = { id: 'm1', timestamp: 1 };
    const identity = {
      jobId: 'j1',
      projectId: 'p1',
      datasetId: 'd1',
      runId: 'r1',
      generation: 'g1',
    };

    expect(BrowserMessageSchema.parse({ ...envelope, type: 'PING' }).type).toBe('PING');

    const batch = BrowserMessageSchema.parse({
      ...envelope,
      type: 'RECORD_BATCH',
      payload: {
        identity,
        sequence: 1,
        page: 1,
        records: [{ _id: 'x', _page: 1, _extractedAt: 1, title: 'A' }],
        stats: { detected: 1, missingFields: 0, filtered: 0, failed: 0, duplicates: 0 },
        navigation: {
          nextPage: 2,
          scrollsCompleted: 0,
          awaitingNavigation: false,
          visitedUrls: [],
          url: 'https://example.com/',
        },
      },
    });
    expect(batch.type).toBe('RECORD_BATCH');

    const cancel = BrowserMessageSchema.parse({
      ...envelope,
      type: 'CANCEL_JOB',
      payload: { jobId: 'j1' },
    });
    expect(cancel.type).toBe('CANCEL_JOB');
  });

  it('requires full identity on every extraction message', () => {
    const envelope = { id: 'm1', timestamp: 1 };
    for (const missing of ['jobId', 'projectId', 'datasetId', 'runId', 'generation']) {
      const identity: Record<string, string> = {
        jobId: 'j1',
        projectId: 'p1',
        datasetId: 'd1',
        runId: 'r1',
        generation: 'g1',
      };
      delete identity[missing];
      const result = BrowserMessageSchema.safeParse({
        ...envelope,
        type: 'JOB_FINISHED',
        payload: { identity, lastSequence: 0, stopReason: 'completed' },
      });
      expect(result.success).toBe(false);
    }
  });

  it('validates ExportConfigSchema with format options and CSV defaults', () => {
    const config = {
      format: 'csv' as const,
      includeMetadata: false,
      csvDelimiter: ',' as const,
      filename: 'my_extracted_data',
    };
    const parsed = ExportConfigSchema.parse(config);
    expect(parsed.format).toBe('csv');
    expect(parsed.csvDelimiter).toBe(',');
    expect(parsed.includeMetadata).toBe(false);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { detectShopifyStore } from '@/core/shopify/detector';
import { fetchShopifyCollections, flattenShopifyProducts, paginateShopifyProducts } from '@/core/shopify/client';
import { recordsToShopifyCsv } from '@/core/export/shopify-csv';
import type { ShopifyProduct } from '@/core/shopify/types';
import type { ExtractedRecord } from '@/types';

describe('Shopify Detector', () => {
  it('detects a Shopify store when /products.json responds with products array', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ products: [{ id: 123, title: 'Test Shoe' }] }),
    });

    const isShopify = await detectShopifyStore('https://mystore.test', fetchFn as unknown as typeof fetch);
    expect(isShopify).toBe(true);
    expect(fetchFn).toHaveBeenCalledWith('https://mystore.test/products.json?limit=1', expect.anything());
  });

  it('returns false when /products.json is 404', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: { get: () => 'text/html' },
    });

    const isShopify = await detectShopifyStore('https://not-shopify.test', fetchFn as unknown as typeof fetch);
    expect(isShopify).toBe(false);
  });
});

describe('Shopify Collection Fetcher', () => {
  it('fetches collections from /collections.json', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        collections: [
          { id: 1, handle: 'summer', title: 'Summer Collection', products_count: 10 },
          { id: 2, handle: 'winter', title: 'Winter Collection', products_count: 5 },
        ],
      }),
    });

    const collections = await fetchShopifyCollections('https://shop.test', fetchFn as unknown as typeof fetch);
    expect(collections).toHaveLength(2);
    expect(collections[0].handle).toBe('summer');
  });
});

describe('Shopify Product Flattening', () => {
  const sampleProduct: ShopifyProduct = {
    id: 101,
    title: 'Snowboard Pro',
    handle: 'snowboard-pro',
    body_html: '<p>Great snowboard</p>',
    vendor: 'SnowCorp',
    product_type: 'Snowboards',
    created_at: '2026-01-01',
    published_at: '2026-01-01',
    tags: ['winter', 'sports'],
    options: [
      { name: 'Size', position: 1, values: ['150cm', '160cm'] },
      { name: 'Color', position: 2, values: ['Blue', 'Red'] },
    ],
    variants: [
      {
        id: 1001,
        title: '150cm / Blue',
        price: '499.00',
        compare_at_price: '599.00',
        sku: 'SB-150-BLU',
        position: 1,
        option1: '150cm',
        option2: 'Blue',
        option3: null,
        grams: 3000,
        image_id: 201,
        available: true,
      },
      {
        id: 1002,
        title: '160cm / Red',
        price: '529.00',
        compare_at_price: null,
        sku: 'SB-160-RED',
        position: 2,
        option1: '160cm',
        option2: 'Red',
        option3: null,
        grams: 3200,
        image_id: null,
        available: false,
      },
    ],
    images: [
      { id: 201, src: 'https://shop.test/images/blue.jpg', position: 1 },
      { id: 202, src: 'https://shop.test/images/red.jpg', position: 2 },
    ],
  };

  it('flattens product into multiple variant rows (one row per variant)', () => {
    const rows = flattenShopifyProducts([sampleProduct], 'https://shop.test', 'variant');
    expect(rows).toHaveLength(2);

    expect(rows[0]['Handle']).toBe('snowboard-pro');
    expect(rows[0]['Title']).toBe('Snowboard Pro');
    expect(rows[0]['Option1 Value']).toBe('150cm');
    expect(rows[0]['Option2 Value']).toBe('Blue');
    expect(rows[0]['Variant SKU']).toBe('SB-150-BLU');
    expect(rows[0]['Variant Price']).toBe('499.00');
    expect(rows[0]['Variant Available']).toBe('true');
    expect(rows[0]['Image Src']).toBe('https://shop.test/images/blue.jpg');

    expect(rows[1]['Handle']).toBe('snowboard-pro');
    expect(rows[1]['Option1 Value']).toBe('160cm');
    expect(rows[1]['Option2 Value']).toBe('Red');
    expect(rows[1]['Variant SKU']).toBe('SB-160-RED');
    expect(rows[1]['Variant Price']).toBe('529.00');
    expect(rows[1]['Variant Available']).toBe('false');
  });

  it('flattens product into single row when granularity is product', () => {
    const rows = flattenShopifyProducts([sampleProduct], 'https://shop.test', 'product');
    expect(rows).toHaveLength(1);
    expect(rows[0]['Handle']).toBe('snowboard-pro');
    expect(rows[0]['Variant Price']).toBe('499.00'); // min price
  });
});

describe('Shopify Paginator with 429 Handling', () => {
  it('retries on HTTP 429 and completes when products end', async () => {
    let callCount = 0;
    const fetchFn = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // First call triggers 429
        return {
          ok: false,
          status: 429,
          headers: { get: (h: string) => (h === 'Retry-After' ? '0' : null) },
        };
      }
      if (callCount === 2) {
        // Retry returns page 1
        return {
          ok: true,
          status: 200,
          json: async () => ({
            products: [{ id: 1, handle: 'p1', title: 'P1', variants: [{ id: 11, price: '10' }] }],
          }),
        };
      }
      // Page 2 empty
      return {
        ok: true,
        status: 200,
        json: async () => ({ products: [] }),
      };
    });

    const batches: ExtractedRecord[][] = [];
    for await (const batch of paginateShopifyProducts({
      storeUrl: 'https://shop.test',
      minDelayMs: 0,
      fetchFn: fetchFn as unknown as typeof fetch,
    })) {
      batches.push(batch);
    }

    expect(batches).toHaveLength(1);
    expect(batches[0][0].Handle).toBe('p1');
    expect(callCount).toBe(3);
  });
});

describe('Shopify Admin CSV Exporter', () => {
  it('formats multi-row variants: row 1 has metadata, row 2 has empty metadata', () => {
    const records = [
      {
        _id: '1',
        _page: 1,
        _extractedAt: 1,
        Handle: 't-shirt',
        Title: 'Cool T-Shirt',
        'Body (HTML)': '<p>Cotton</p>',
        Vendor: 'Apparel Co',
        Type: 'Shirts',
        Tags: 'summer, cool',
        'Option1 Name': 'Size',
        'Option1 Value': 'S',
        'Variant SKU': 'TS-S',
        'Variant Price': '25.00',
        'Image Src': 'https://shop.test/s.jpg',
      },
      {
        _id: '2',
        _page: 1,
        _extractedAt: 1,
        Handle: 't-shirt',
        Title: 'Cool T-Shirt',
        'Body (HTML)': '<p>Cotton</p>',
        Vendor: 'Apparel Co',
        Type: 'Shirts',
        Tags: 'summer, cool',
        'Option1 Name': 'Size',
        'Option1 Value': 'M',
        'Variant SKU': 'TS-M',
        'Variant Price': '25.00',
        'Image Src': 'https://shop.test/m.jpg',
      },
    ];

    const csv = recordsToShopifyCsv(records as unknown as ExtractedRecord[], false);
    const lines = csv.split('\r\n');

    expect(lines[0]).toContain('Handle,Title,Body (HTML)');

    // Row 1: has Title, Body, Vendor
    expect(lines[1]).toContain('t-shirt,Cool T-Shirt,<p>Cotton</p>,Apparel Co');
    expect(lines[1]).toContain('TS-S');

    // Row 2: handle is populated, but Title, Body, Vendor are blank
    expect(lines[2]).toContain('t-shirt,,,,');
    expect(lines[2]).toContain('TS-M');
  });
});

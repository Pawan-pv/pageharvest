import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { detectListFromSelection, autoDetectLists } from '@/core/detection';

function loadFixture(filename: string): string {
  const filePath = path.resolve(__dirname, '../fixtures/pages', filename);
  return fs.readFileSync(filePath, 'utf-8');
}

describe('Integration: Repeated List & Field Detection on Realistic HTML Fixtures', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('detects product cards in simple-grid.html', () => {
    document.documentElement.innerHTML = loadFixture('simple-grid.html');
    const title = document.querySelector('.product-title')!;
    const result = detectListFromSelection(title);

    expect(result).not.toBeNull();
    expect(result?.itemCount).toBe(3);
    expect(result?.name).toMatch(/product/i);
    expect(result?.confidence).toBeGreaterThanOrEqual(0.85);

    const fields = result?.availableFields || [];
    expect(fields.some((f) => f.type === 'price')).toBe(true);
    expect(fields.some((f) => f.type === 'image')).toBe(true);
    expect(fields.some((f) => f.type === 'link')).toBe(true);
    expect(fields.some((f) => f.type === 'rating')).toBe(true);
  });

  it('detects 20 product cards with high confidence in twenty-cards.html', () => {
    document.documentElement.innerHTML = loadFixture('twenty-cards.html');
    const firstCard = document.querySelector('.catalog-item')!;
    const result = detectListFromSelection(firstCard);

    expect(result).not.toBeNull();
    expect(result?.itemCount).toBeGreaterThanOrEqual(15);
    expect(result?.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('detects tech job listings in job-listings.html', () => {
    document.documentElement.innerHTML = loadFixture('job-listings.html');
    const company = document.querySelector('.company-name')!;
    const result = detectListFromSelection(company);

    expect(result).not.toBeNull();
    expect(result?.itemCount).toBe(6);
    expect(result?.name).toMatch(/job/i);

    const fields = result?.availableFields || [];
    const salary = fields.find((f) => f.type === 'price');
    const date = fields.find((f) => f.type === 'date');
    const button = fields.find((f) => f.type === 'button');

    expect(salary).toBeDefined();
    expect(salary?.sampleValue).toContain('150000');
    expect(date).toBeDefined();
    expect(button).toBeDefined();
  });

  it('detects article news feed in article-listings.html', () => {
    document.documentElement.innerHTML = loadFixture('article-listings.html');
    const headline = document.querySelector('.article-title a')!;
    const result = detectListFromSelection(headline);

    expect(result).not.toBeNull();
    expect(result?.itemCount).toBe(4);
    expect(result?.name).toMatch(/article|post/i);

    const fields = result?.availableFields || [];
    const dateField = fields.find((f) => f.type === 'date');
    const thumbField = fields.find((f) => f.type === 'image');
    const excerptField = fields.find((f) => f.name.toLowerCase().includes('description'));

    expect(dateField).toBeDefined();
    expect(thumbField).toBeDefined();
    expect(excerptField).toBeDefined();
  });

  it('detects business listings in business-directory.html', () => {
    document.documentElement.innerHTML = loadFixture('business-directory.html');
    const bizUrl = document.querySelector('.biz-url')!;
    const result = detectListFromSelection(bizUrl);

    expect(result).not.toBeNull();
    expect(result?.itemCount).toBe(4);
    expect(result?.name).toMatch(/business|directory/i);

    const fields = result?.availableFields || [];
    const ratingField = fields.find((f) => f.type === 'rating');
    const btnField = fields.find((f) => f.type === 'button');

    expect(ratingField).toBeDefined();
    expect(btnField).toBeDefined();
  });

  it('detects table rows and horizontal cards in different-card-layouts.html', () => {
    document.documentElement.innerHTML = loadFixture('different-card-layouts.html');
    const tableCell = document.querySelector('.sku-cell')!;
    const tableResult = detectListFromSelection(tableCell);

    expect(tableResult).not.toBeNull();
    expect(tableResult?.itemCount).toBe(4);
    expect(tableResult?.name).toMatch(/table|row/i);
    expect(tableResult?.containerSelector).toMatch(/tr/i);

    const mediaTitle = document.querySelector('.media-title')!;
    const mediaResult = detectListFromSelection(mediaTitle);

    expect(mediaResult).not.toBeNull();
    expect(mediaResult?.itemCount).toBe(3);
    expect(mediaResult?.containerSelector).toMatch(/media-card|horizontal-card|li/i);
  });

  it('isolates product cards from sidebar news in similar-unrelated.html', () => {
    document.documentElement.innerHTML = loadFixture('similar-unrelated.html');
    const catalogItemTitle = document.querySelector('.catalog-item .item-title a')!;
    const result = detectListFromSelection(catalogItemTitle);

    expect(result).not.toBeNull();
    expect(result?.itemCount).toBe(4);

    for (const item of result?.matchedElements || []) {
      expect(item.classList.contains('catalog-item') || item.classList.contains('product-entry')).toBe(true);
      expect(item.classList.contains('news-item')).toBe(false);
      expect(item.classList.contains('breadcrumb-item')).toBe(false);
    }
  });

  it('auto-detects all lists across a document with autoDetectLists()', () => {
    document.documentElement.innerHTML = loadFixture('similar-unrelated.html');
    const lists = autoDetectLists(document);

    expect(lists.length).toBeGreaterThan(0);
    const catalogList = lists.find((l) => l.itemCount === 4);
    expect(catalogList).toBeDefined();
    expect(catalogList?.confidence).toBeGreaterThanOrEqual(0.70);
  });
});

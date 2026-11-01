import { describe, it, expect } from 'vitest';
import {
  generateNextPageUrl,
  createUrlPaginationRunner,
  normalizeUrlForDeduplication,
} from '@/core/navigation/url-paginator';

describe('URL Pagination Strategy & Loop Prevention', () => {
  it('generates next page URL using query parameter', () => {
    const url1 = 'https://example.com/search?query=desk&page=1';
    const next1 = generateNextPageUrl(url1, { currentPage: 1, nextPage: 2 });
    expect(next1).toBe('https://example.com/search?query=desk&page=2');

    const url2 = 'https://example.com/items?p=9';
    const next2 = generateNextPageUrl(url2, { currentPage: 9, nextPage: 10 });
    expect(next2).toBe('https://example.com/items?p=10');
  });

  it('generates next page URL using offset pattern', () => {
    const url = 'https://example.com/api/items?offset=0&limit=25';
    const next = generateNextPageUrl(url, { currentPage: 1, nextPage: 2, pageSize: 25 });
    expect(next).toBe('https://example.com/api/items?offset=25&limit=25');
  });

  it('generates next page URL using path-based numbers', () => {
    const url = 'https://example.com/category/books/page/1/';
    const next = generateNextPageUrl(url, { currentPage: 1, nextPage: 2 });
    expect(next).toBe('https://example.com/category/books/page/2/');
  });

  it('supports explicit parametric URL templates', () => {
    const template = 'https://example.com/store?cat=electronics&page={page}';
    const next = generateNextPageUrl('https://example.com/store?cat=electronics&page=1', {
      currentPage: 1,
      nextPage: 2,
      template,
    });
    expect(next).toBe('https://example.com/store?cat=electronics&page=2');
  });

  it('normalizes URLs to catch cyclic / repeated loops regardless of trailing slashes or hash', () => {
    const u1 = 'https://example.com/products?page=2#reviews';
    const u2 = 'https://example.com/products/?page=2';

    expect(normalizeUrlForDeduplication(u1)).toBe(normalizeUrlForDeduplication(u2));
  });

  it('tracks visited URLs and aborts when encountering a repeated URL cycle', () => {
    const runner = createUrlPaginationRunner({
      startUrl: 'https://example.com/page1',
      maxPages: 5,
    });

    expect(runner.visit('https://example.com/page1')).toBe(true);
    expect(runner.visit('https://example.com/page2')).toBe(true);
    expect(runner.hasVisited('https://example.com/page1')).toBe(true);

    // Visiting page 1 again triggers loop detection
    expect(runner.visit('https://example.com/page1')).toBe(false);
    expect(runner.isLoopDetected()).toBe(true);
  });
});

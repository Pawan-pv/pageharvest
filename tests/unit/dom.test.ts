import { describe, it, expect } from 'vitest';
import {
  normalizeText,
  resolveAbsoluteUrl,
  parseNumberValue,
  hashString,
  computeRecordHash,
} from '@/utils/dom';

describe('DOM & Value Utilities', () => {
  it('normalizes text by stripping redundant whitespace and linebreaks', () => {
    const raw = '   Hello \n\n\t world!   This   is   a test.   ';
    expect(normalizeText(raw)).toBe('Hello world! This is a test.');
    expect(normalizeText(null)).toBe('');
    expect(normalizeText(undefined)).toBe('');
  });

  it('resolves relative URLs to absolute URLs', () => {
    const base = 'https://example.com/store/items/';
    expect(resolveAbsoluteUrl('/product/123', base)).toBe('https://example.com/product/123');
    expect(resolveAbsoluteUrl('details?id=45', base)).toBe('https://example.com/store/items/details?id=45');
    expect(resolveAbsoluteUrl('https://other.com/pic.png', base)).toBe('https://other.com/pic.png');
    expect(resolveAbsoluteUrl('data:image/png;base64,abc', base)).toBe('data:image/png;base64,abc');
  });

  it('parses numbers and prices accurately', () => {
    expect(parseNumberValue('$1,249.99')).toBe(1249.99);
    expect(parseNumberValue('Price: 42 €')).toBe(42);
    expect(parseNumberValue('-15.5%')).toBe(-15.5);
    expect(parseNumberValue('Out of stock')).toBeNull();
    expect(parseNumberValue('')).toBeNull();
  });

  it('computes consistent hashes for records ignoring metadata keys', () => {
    const recordA = {
      _id: '1',
      _page: 1,
      _extractedAt: 12345,
      title: 'Gaming Laptop',
      price: 1999,
    };

    const recordB = {
      _id: '99',
      _page: 4,
      _extractedAt: 67890,
      price: 1999,
      title: 'Gaming Laptop', // same fields, different order & metadata
    };

    const recordC = {
      _id: '1',
      _page: 1,
      _extractedAt: 12345,
      title: 'Gaming Laptop Pro',
      price: 2499,
    };

    const hashA = computeRecordHash(recordA);
    const hashB = computeRecordHash(recordB);
    const hashC = computeRecordHash(recordC);

    expect(hashA).toBe(hashB);
    expect(hashA).not.toBe(hashC);
    expect(hashA.length).toBe(8);
  });
});

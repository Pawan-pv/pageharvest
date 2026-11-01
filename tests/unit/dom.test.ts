import { describe, it, expect } from 'vitest';
import {
  normalizeText,
  resolveAbsoluteUrl,
  parseNumberValue,
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
});

import { describe, it, expect } from 'vitest';
import {
  normalizeText,
  normalizeNumber,
  normalizeUrl,
  normalizeRegex,
  normalizeFieldValue
} from '@/core/extraction/normalizer';

describe('Data Normalization', () => {
  describe('normalizeText', () => {
    it('trims leading and trailing whitespace', () => {
      expect(normalizeText('  Hello World  ')).toBe('Hello World');
    });

    it('collapses internal repeated whitespace and tabs', () => {
      expect(normalizeText('Product    Title \t with \n linebreaks')).toBe(
        'Product Title with linebreaks'
      );
    });

    it('replaces non-breaking spaces (\\u00A0) with standard space', () => {
      expect(normalizeText('Item\u00A0Name\u00A0Extra')).toBe('Item Name Extra');
    });

    it('handles null and undefined safely', () => {
      expect(normalizeText(null)).toBe('');
      expect(normalizeText(undefined)).toBe('');
    });
  });

  describe('normalizeNumber', () => {
    it('parses standard US formatted currencies ($19.99 -> 19.99)', () => {
      expect(normalizeNumber('$19.99')).toBe(19.99);
      expect(normalizeNumber('$ 1,299.50')).toBe(1299.5);
    });

    it('parses European format with decimal commas (€ 49,99 -> 49.99)', () => {
      expect(normalizeNumber('€ 49,99')).toBe(49.99);
      expect(normalizeNumber('1.450,00 €')).toBe(1450.0);
    });

    it('parses negative numbers and discounts (-15% -> -15)', () => {
      expect(normalizeNumber('-15%')).toBe(-15);
      expect(normalizeNumber('-$25.50')).toBe(-25.5);
    });

    it('parses plain numbers directly', () => {
      expect(normalizeNumber(42.5)).toBe(42.5);
      expect(normalizeNumber('100')).toBe(100);
    });

    it('returns null for non-numeric or empty strings', () => {
      expect(normalizeNumber('Out of stock')).toBeNull();
      expect(normalizeNumber('')).toBeNull();
      expect(normalizeNumber(null)).toBeNull();
    });
  });

  describe('normalizeUrl', () => {
    const base = 'https://example.com/shop/catalog/';

    it('resolves relative URLs against base URL', () => {
      expect(normalizeUrl('../item/101', base)).toBe('https://example.com/shop/item/101');
      expect(normalizeUrl('/products/p1', base)).toBe('https://example.com/products/p1');
    });

    it('preserves already absolute URLs', () => {
      expect(normalizeUrl('https://cdn.example.org/img.png', base)).toBe(
        'https://cdn.example.org/img.png'
      );
    });

    it('ignores javascript: links and returns null', () => {
      expect(normalizeUrl('javascript:void(0)', base)).toBeNull();
      expect(normalizeUrl('', base)).toBeNull();
      expect(normalizeUrl(null, base)).toBeNull();
    });
  });

  describe('normalizeRegex', () => {
    it('extracts matching capture group', () => {
      const text = 'Model: SKU-98765-XL (In Stock)';
      const pattern = 'SKU-([0-9]+)-([A-Z]+)';
      expect(normalizeRegex(text, pattern, 1)).toBe('98765');
      expect(normalizeRegex(text, pattern, 2)).toBe('XL');
    });

    it('returns full match when group index is 0', () => {
      const text = 'Serial Number: SN123456';
      expect(normalizeRegex(text, 'SN\\d+', 0)).toBe('SN123456');
    });

    it('returns null if pattern does not match', () => {
      expect(normalizeRegex('ABC', '\\d+')).toBeNull();
    });
  });

  describe('normalizeFieldValue master dispatcher', () => {
    it('applies default value when extracted value is empty', () => {
      expect(
        normalizeFieldValue('', 'text', { defaultValue: 'Default Name' })
      ).toBe('Default Name');

      expect(
        normalizeFieldValue(null, 'number', { defaultValue: '0' })
      ).toBe('0');
    });

    it('dispatches properly to number extractor', () => {
      expect(normalizeFieldValue('$99.00', 'number')).toBe(99);
    });

    it('dispatches properly to href extractor with base URL', () => {
      expect(
        normalizeFieldValue('/prod/item1', 'href', { baseUrl: 'https://mysite.com/dir/' })
      ).toBe('https://mysite.com/prod/item1');
    });
  });
});

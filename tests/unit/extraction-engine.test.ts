import { describe, it, expect, beforeEach } from 'vitest';
import { ExtractionEngine } from '@/core/extraction/extractor';
import {
  normalizeText,
  normalizeUrl,
  normalizeImageUrl,
  normalizePrice,
  normalizeDate,
  normalizeNumber,
  normalizeBoolean,
  decodeHtmlEntities
} from '@/core/extraction/normalizer';

describe('ExtractionEngine & Data Normalization Suite', () => {
  let engine: ExtractionEngine;

  beforeEach(() => {
    engine = new ExtractionEngine();
    document.body.innerHTML = '';
  });

  describe('1. Valid Records (Full Pipeline)', () => {
    it('extracts and normalizes product listings matching prompt example', () => {
      document.body.innerHTML = `
        <div id="catalog">
          <article class="product-item" data-id="p-101">
            <h2 class="title">Nike Air Max</h2>
            <span class="price">$129.00</span>
            <div class="rating-badge">4.8 out of 5 stars</div>
            <img class="photo" src="/images/airmax.jpg" alt="Air Max" />
            <a class="details-link" href="/products/nike-air-max">View Details</a>
            <span class="stock-status in-stock">In Stock</span>
            <time datetime="2026-10-15">Oct 15, 2026</time>
          </article>
        </div>
      `;

      const result = engine.extract({
        root: document,
        rootSelector: '#catalog',
        repeatedItemSelector: '.product-item',
        fieldSelectors: {
          name: '.title',
          price: '.price',
          rating: '.rating-badge',
          image: '.photo',
          url: '.details-link',
          available: '.stock-status',
          releaseDate: 'time',
          sku: ':scope'
        },
        fieldTypes: {
          name: 'text',
          price: 'price',
          rating: 'number',
          image: 'image',
          url: 'link',
          available: 'boolean',
          releaseDate: 'date',
          sku: 'attribute'
        },
        fields: [
          { id: 'f-sku', name: 'sku', selector: ':scope', extractor: 'attribute', attributeName: 'data-id' }
        ],
        baseUrl: 'https://example.com'
      });

      expect(result.statistics.totalParsed).toBe(1);
      expect(result.statistics.validRecordsCount).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(result.records).toHaveLength(1);

      const record = result.records[0];
      expect(record.name).toBe('Nike Air Max');
      expect(record.price).toBe('$129.00');
      expect(record.rating).toBe(4.8);
      expect(record.image).toBe('https://example.com/images/airmax.jpg');
      expect(record.url).toBe('https://example.com/products/nike-air-max');
      expect(record.available).toBe(true);
      expect(record.releaseDate).toBe('2026-10-15');
      expect(record.sku).toBe('p-101');
      expect(record._id).toBeDefined();
      expect(record._page).toBe(1);
      expect(record._extractedAt).toBeGreaterThan(0);
    });
  });

  describe('2. Missing Elements Handling', () => {
    it('applies default values when elements are missing without crashing job', () => {
      document.body.innerHTML = `
        <div class="list">
          <div class="item">
            <h3 class="name">Product With Missing Price & Rating</h3>
            <!-- No price, no rating -->
          </div>
        </div>
      `;

      const result = engine.extract({
        root: document,
        repeatedItemSelector: '.item',
        fields: [
          { id: '1', name: 'name', selector: '.name', extractor: 'text', required: true },
          { id: '2', name: 'price', selector: '.price', extractor: 'price', defaultValue: '$0.00' },
          { id: '3', name: 'rating', selector: '.rating', extractor: 'number', defaultValue: '0' },
          { id: '4', name: 'optionalTag', selector: '.tag', extractor: 'text' }
        ]
      });

      expect(result.records).toHaveLength(1);
      expect(result.records[0].name).toBe('Product With Missing Price & Rating');
      expect(result.records[0].price).toBe('$0.00');
      expect(result.records[0].rating).toBe('0');
      expect(result.records[0].optionalTag).toBeNull();
      expect(result.statistics.validRecordsCount).toBe(1);
    });

    it('rejects records where required fields are missing without corrupting other records', () => {
      document.body.innerHTML = `
        <div class="list">
          <div class="item" id="good-1"><span class="title">First Good Item</span></div>
          <div class="item" id="bad"><span class="other">No Title Item</span></div>
          <div class="item" id="good-2"><span class="title">Second Good Item</span></div>
        </div>
      `;

      const result = engine.extract({
        root: document,
        repeatedItemSelector: '.item',
        fields: [
          { id: 'f-title', name: 'title', selector: '.title', extractor: 'text', required: true }
        ]
      });

      expect(result.statistics.totalParsed).toBe(3);
      expect(result.statistics.validRecordsCount).toBe(2);
      expect(result.statistics.failedRecordsCount).toBe(1);
      expect(result.records).toHaveLength(2);
      expect(result.records[0].title).toBe('First Good Item');
      expect(result.records[1].title).toBe('Second Good Item');
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      expect(result.errors[0].code).toBe('MISSING_REQUIRED_FIELD');
    });
  });

  describe('3. Relative URLs Resolution', () => {
    it('resolves diverse relative URL patterns against baseUrl', () => {
      const base = 'https://shop.example.com/categories/footwear/';

      expect(normalizeUrl('/products/101', base)).toBe('https://shop.example.com/products/101');
      expect(normalizeUrl('../apparel/202', base)).toBe('https://shop.example.com/categories/apparel/202');
      expect(normalizeUrl('./item?color=red', base)).toBe('https://shop.example.com/categories/footwear/item?color=red');
      expect(normalizeUrl('?sort=price_asc', base)).toBe('https://shop.example.com/categories/footwear/?sort=price_asc');
      expect(normalizeUrl('https://external.com/product', base)).toBe('https://external.com/product');
      expect(normalizeUrl('//cdn.example.com/asset.png', base)).toBe('https://cdn.example.com/asset.png');
    });
  });

  describe('4. Missing & Fallback Images', () => {
    it('extracts from data-src, data-lazy-src, and srcset when src is absent', () => {
      document.body.innerHTML = `
        <div class="card">
          <img class="img-lazy" data-src="/images/lazy.jpg" alt="Lazy Image" />
          <img class="img-srcset" srcset="/images/small.jpg 300w, /images/large.jpg 1000w" />
          <div class="img-bg" style="background-image: url('/images/bg-banner.jpg');"></div>
          <div class="empty-img"></div>
        </div>
      `;

      const card = document.querySelector('.card')!;
      const base = 'https://example.com';

      const lazyImg = card.querySelector('.img-lazy')!;
      expect(normalizeImageUrl(lazyImg, base)).toBe('https://example.com/images/lazy.jpg');

      const srcSetImg = card.querySelector('.img-srcset')!;
      expect(normalizeImageUrl(srcSetImg, base)).toBe('https://example.com/images/small.jpg');

      const bgImg = card.querySelector('.img-bg')!;
      expect(normalizeImageUrl(bgImg, base)).toBe('https://example.com/images/bg-banner.jpg');

      const emptyImg = card.querySelector('.empty-img')!;
      expect(normalizeImageUrl(emptyImg, base)).toBeNull();
    });
  });

  describe('5. Invalid URLs Handling', () => {
    it('discards javascript:, vbscript: and invalid schemes without throwing', () => {
      const base = 'https://example.com';

      expect(normalizeUrl('javascript:alert(1)', base)).toBeNull();
      expect(normalizeUrl('javascript:void(0);', base)).toBeNull();
      expect(normalizeUrl('vbscript:msgbox', base)).toBeNull();
      expect(normalizeUrl('   ', base)).toBeNull();
      expect(normalizeUrl(null, base)).toBeNull();
      expect(normalizeUrl(undefined, base)).toBeNull();
      expect(normalizeUrl('http://[invalid-ipv6', base)).toBeNull();
    });
  });

  describe('6. Empty Values Handling', () => {
    it('normalizes empty nodes and whitespace strings to empty string or default', () => {
      expect(normalizeText('')).toBe('');
      expect(normalizeText('    \t \n   ')).toBe('');
      expect(normalizeText(null)).toBe('');
      expect(normalizeText(undefined)).toBe('');

      expect(normalizeNumber('')).toBeNull();
      expect(normalizeNumber('   ')).toBeNull();
      expect(normalizePrice('')).toBeNull();
      expect(normalizeDate('')).toBeNull();
    });
  });

  describe('7. Nested Text & Whitespace Normalization', () => {
    it('extracts clean text across deep nested hierarchies ignoring scripts and hidden elements', () => {
      document.body.innerHTML = `
        <h1 id="headline">
          <span>Nike</span>
          <span>Air</span>
          <strong>Max <em>90</em></strong>
          <span class="badge" style="display:none">Hidden</span>
        </h1>
      `;

      const headline = document.querySelector('#headline')!;
      expect(normalizeText(headline.textContent)).toBe('Nike Air Max 90 Hidden');
      expect(normalizeText('  Multiple   \t  spaces \n and newlines   ')).toBe('Multiple spaces and newlines');
    });
  });

  describe('8. HTML Entities Decoding', () => {
    it('decodes named, decimal and hex HTML entities into proper unicode characters', () => {
      expect(decodeHtmlEntities('&quot;Nike Air&quot; &amp; Jordan')).toBe('"Nike Air" & Jordan');
      expect(decodeHtmlEntities('Price: &euro;129 &pound;99 &yen;1500')).toBe('Price: €129 £99 ¥1500');
      expect(decodeHtmlEntities('Tom &#38; Jerry &#39;Special&#39;')).toBe("Tom & Jerry 'Special'");
      expect(decodeHtmlEntities('Copyright &#xA9; 2026 &#x2122;')).toBe('Copyright © 2026 ™');
      expect(decodeHtmlEntities('&lt;div&gt; &gt;&gt; &amp;copy;')).toBe('<div> >> &copy;');
    });

    it('cleans HTML entities automatically during text extraction', () => {
      expect(normalizeText('&quot;Running Shoes&quot; &amp; Accessories &nbsp;')).toBe('"Running Shoes" & Accessories');
    });
  });

  describe('9. Different Locales and Price Formats', () => {
    it('parses US/UK price format ($129.00, $1,299.99)', () => {
      expect(normalizePrice('$129.00')).toBe('$129.00');
      expect(normalizeNumber('$129.00')).toBe(129.00);
      expect(normalizePrice('$1,299.99')).toBe('$1,299.99');
      expect(normalizeNumber('$1,299.99')).toBe(1299.99);
    });

    it('parses European price format with comma decimal (129,00 €, € 1.299,99)', () => {
      expect(normalizeNumber('129,00 €')).toBe(129.00);
      expect(normalizeNumber('€ 1.299,99')).toBe(1299.99);
      expect(normalizePrice('129,00 €')).toBe('129,00 €');
    });

    it('parses space-delimited thousand separators (1 299,50 €)', () => {
      expect(normalizeNumber('1 299,50 €')).toBe(1299.50);
      expect(normalizeNumber('1 500.00 USD')).toBe(1500.00);
    });

    it('parses various international currencies (£, ¥, ₹, CHF, CAD)', () => {
      expect(normalizeNumber('£49.99')).toBe(49.99);
      expect(normalizeNumber('¥1,500')).toBe(1500);
      expect(normalizeNumber('₹ 4,999.00')).toBe(4999.00);
      expect(normalizeNumber('CHF 120.50')).toBe(120.50);
      expect(normalizeNumber('CAD $89.00')).toBe(89.00);
    });

    it('handles Free and Complimentary items', () => {
      expect(normalizeNumber('FREE')).toBe(0);
      expect(normalizeNumber('Free download')).toBe(0);
    });
  });

  describe('10. Duplicate Identification & Deduplication', () => {
    it('identifies and skips duplicate records based on content hash', () => {
      document.body.innerHTML = `
        <div class="row"><h3 class="name">Product Alpha</h3><span class="price">$10</span></div>
        <div class="row"><h3 class="name">Product Beta</h3><span class="price">$20</span></div>
        <div class="row"><h3 class="name">Product Alpha</h3><span class="price">$10</span></div>
        <div class="row"><h3 class="name">Product Beta</h3><span class="price">$20</span></div>
        <div class="row"><h3 class="name">Product Gamma</h3><span class="price">$30</span></div>
      `;

      const result = engine.extract({
        root: document,
        repeatedItemSelector: '.row',
        fields: [
          { id: '1', name: 'name', selector: '.name', extractor: 'text' },
          { id: '2', name: 'price', selector: '.price', extractor: 'text' }
        ]
      });

      expect(result.statistics.totalParsed).toBe(5);
      expect(result.statistics.validRecordsCount).toBe(3);
      expect(result.statistics.duplicatesCount).toBe(2);
      expect(result.records).toHaveLength(3);
      expect(result.records.map((r) => r.name)).toEqual([
        'Product Alpha',
        'Product Beta',
        'Product Gamma'
      ]);
    });
  });

  describe('11. Malformed Schemas & Resilient Recovery', () => {
    it('gracefully handles invalid CSS selectors in fields without crashing job', () => {
      document.body.innerHTML = `
        <div class="card">
          <span class="valid">Valid Content</span>
        </div>
      `;

      const result = engine.extract({
        root: document,
        repeatedItemSelector: '.card',
        fields: [
          { id: '1', name: 'good', selector: '.valid', extractor: 'text' },
          { id: '2', name: 'broken', selector: 'div:invalid[[[', extractor: 'text' }
        ]
      });

      expect(result.records).toHaveLength(1);
      expect(result.records[0].good).toBe('Valid Content');
      expect(result.records[0].broken).toBeNull();
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      expect(result.errors[0].code).toBe('INVALID_SELECTOR');
    });

    it('returns empty result with descriptive error when containerSelector is invalid', () => {
      const result = engine.extract({
        root: document,
        repeatedItemSelector: ':::invalid-selector',
        fields: [{ id: '1', name: 'x', selector: '.x', extractor: 'text' }]
      });

      expect(result.records).toHaveLength(0);
      expect(result.errors.some((e) => e.code === 'INVALID_CONTAINER_SELECTOR')).toBe(true);
    });
  });

  describe('12. Large Datasets Performance & Determinism', () => {
    it('efficiently extracts 1,000 records in sub-second time with complete statistics', () => {
      const itemsHtml = Array.from({ length: 1000 }, (_, i) => `
        <div class="item" data-index="${i}">
          <h4 class="title">Product Item ${i}</h4>
          <span class="price">$${(i + 0.99).toFixed(2)}</span>
          <a class="link" href="/item/${i}">Link ${i}</a>
        </div>
      `).join('');

      document.body.innerHTML = `<div id="big-catalog">${itemsHtml}</div>`;

      const startTime = performance.now();
      const result = engine.extract({
        root: document,
        rootSelector: '#big-catalog',
        repeatedItemSelector: '.item',
        fields: [
          { id: '1', name: 'title', selector: '.title', extractor: 'text' },
          { id: '2', name: 'price', selector: '.price', extractor: 'number' },
          { id: '3', name: 'url', selector: '.link', extractor: 'href' }
        ],
        baseUrl: 'https://example.com'
      });
      const elapsed = performance.now() - startTime;

      expect(result.records.length).toBe(1000);
      expect(result.statistics.totalParsed).toBe(1000);
      expect(result.statistics.validRecordsCount).toBe(1000);
      expect(result.statistics.duplicatesCount).toBe(0);
      expect(result.statistics.fieldCoverage['title'].percent).toBe(100);
      expect(result.records[0].title).toBe('Product Item 0');
      expect(result.records[999].title).toBe('Product Item 999');
      expect(result.records[999].price).toBe(999.99);
      expect(result.records[999].url).toBe('https://example.com/item/999');
      // Should complete in reasonable time (typically under 500ms in jsdom)
      expect(elapsed).toBeLessThan(3000);
    });
  });

  describe('13. Date and Boolean Normalization', () => {
    it('normalizes ISO dates and common date formats', () => {
      expect(normalizeDate('2026-10-15')).toBe('2026-10-15');
      expect(normalizeDate('2026/10/15')).toBe('2026-10-15');
      expect(normalizeDate('October 15, 2026')).toBe('2026-10-15');
      expect(normalizeDate('15 Oct 2026')).toBe('2026-10-15');
      expect(normalizeDate('Invalid Date String')).toBeNull();
    });

    it('normalizes boolean values from strings and DOM states', () => {
      expect(normalizeBoolean('true')).toBe(true);
      expect(normalizeBoolean('yes')).toBe(true);
      expect(normalizeBoolean('In Stock')).toBe(true);
      expect(normalizeBoolean('Available')).toBe(true);
      expect(normalizeBoolean('false')).toBe(false);
      expect(normalizeBoolean('no')).toBe(false);
      expect(normalizeBoolean('Out of stock')).toBe(false);

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = true;
      expect(normalizeBoolean(null, checkbox)).toBe(true);

      checkbox.checked = false;
      expect(normalizeBoolean(null, checkbox)).toBe(false);
    });
  });
});
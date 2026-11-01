import { describe, it, expect, beforeEach } from 'vitest';
import {
  isDynamicId,
  isPresentationOrUtilityClass,
  filterSemanticClasses,
  generateBestSelector,
  generateSelectorCandidates,
  generateXPath,
  escapeCssSelector
} from '@/content/picker/selector-engine';

describe('Selector Engine', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('isDynamicId', () => {
    it('identifies dynamically generated framework IDs', () => {
      expect(isDynamicId('ember12345')).toBe(true);
      expect(isDynamicId(':r1:')).toBe(true);
      expect(isDynamicId('1234-random')).toBe(true);
      expect(isDynamicId('sc-bdVaJa')).toBe(true);
      expect(isDynamicId('react-select-3-input')).toBe(true);
      expect(isDynamicId('uid-a8f9c2d1')).toBe(true);
      expect(isDynamicId('9876543210')).toBe(true);
    });

    it('identifies stable semantic IDs', () => {
      expect(isDynamicId('main-content')).toBe(false);
      expect(isDynamicId('product-catalog')).toBe(false);
      expect(isDynamicId('site-header')).toBe(false);
      expect(isDynamicId('cart-summary')).toBe(false);
    });
  });

  describe('isPresentationOrUtilityClass', () => {
    it('filters Tailwind and CSS utility classes', () => {
      expect(isPresentationOrUtilityClass('flex')).toBe(true);
      expect(isPresentationOrUtilityClass('items-center')).toBe(true);
      expect(isPresentationOrUtilityClass('justify-between')).toBe(true);
      expect(isPresentationOrUtilityClass('p-4')).toBe(true);
      expect(isPresentationOrUtilityClass('px-2')).toBe(true);
      expect(isPresentationOrUtilityClass('mt-6')).toBe(true);
      expect(isPresentationOrUtilityClass('text-sm')).toBe(true);
      expect(isPresentationOrUtilityClass('font-bold')).toBe(true);
      expect(isPresentationOrUtilityClass('rounded-lg')).toBe(true);
      expect(isPresentationOrUtilityClass('bg-white')).toBe(true);
      expect(isPresentationOrUtilityClass('grid-cols-3')).toBe(true);
    });

    it('filters CSS-in-JS hashes and state classes', () => {
      expect(isPresentationOrUtilityClass('css-14x9ab')).toBe(true);
      expect(isPresentationOrUtilityClass('sc-bdVaJa')).toBe(true);
      expect(isPresentationOrUtilityClass('active')).toBe(true);
      expect(isPresentationOrUtilityClass('is-open')).toBe(true);
      expect(isPresentationOrUtilityClass('disabled')).toBe(true);
    });

    it('preserves domain-specific semantic classes', () => {
      expect(isPresentationOrUtilityClass('product-card')).toBe(false);
      expect(isPresentationOrUtilityClass('price-tag')).toBe(false);
      expect(isPresentationOrUtilityClass('author-bio')).toBe(false);
      expect(isPresentationOrUtilityClass('search-result')).toBe(false);
    });
  });

  describe('filterSemanticClasses', () => {
    it('filters out presentation utility classes while keeping semantic classes', () => {
      const classes = ['product-card', 'flex', 'p-4', 'font-bold', 'featured-item'];
      const filtered = filterSemanticClasses(classes);
      expect(filtered).toEqual(['product-card', 'featured-item']);
    });
  });

  describe('escapeCssSelector', () => {
    it('escapes special characters for safe CSS selector usage', () => {
      expect(escapeCssSelector('foo:bar')).toBe('foo\\:bar');
      expect(escapeCssSelector('item.name')).toBe('item\\.name');
    });
  });

  describe('generateBestSelector', () => {
    it('prefers test attributes when available', () => {
      document.body.innerHTML = `
        <div class="flex p-4" data-testid="checkout-button">
          <span>Checkout</span>
        </div>
      `;
      const element = document.querySelector('[data-testid="checkout-button"]')!;
      const selector = generateBestSelector(element);
      expect(selector).toBe('[data-testid="checkout-button"]');
    });

    it('prefers stable ID when unique and not dynamic', () => {
      document.body.innerHTML = `
        <div id="product-gallery" class="gallery-container">
          <img src="pic.jpg">
        </div>
      `;
      const element = document.getElementById('product-gallery')!;
      const selector = generateBestSelector(element);
      expect(selector).toBe('#product-gallery');
    });

    it('avoids dynamic IDs and prefers semantic classes', () => {
      document.body.innerHTML = `
        <div id=":r2:" class="product-listing p-4 flex">
          <h2 class="product-title font-bold text-lg">Mechanical Keyboard</h2>
        </div>
      `;
      const element = document.querySelector('.product-title')!;
      const selector = generateBestSelector(element);
      expect(selector).not.toContain(':r2:');
      expect(selector).toContain('product-title');
      expect(document.querySelector(selector)).toBe(element);
    });

    it('uses semantic attributes for elements without unique classes', () => {
      document.body.innerHTML = `
        <form>
          <input type="email" name="user-email" placeholder="Enter email">
        </form>
      `;
      const input = document.querySelector('input')!;
      const selector = generateBestSelector(input);
      expect(selector).toContain('name="user-email"');
      expect(document.querySelector(selector)).toBe(input);
    });

    it('uses parent-child hierarchy to resolve disambiguation without deep nth-child', () => {
      document.body.innerHTML = `
        <section class="featured-products">
          <div class="product-card">
            <h3 class="product-name">Card 1</h3>
          </div>
        </section>
        <section class="recent-products">
          <div class="product-card">
            <h3 class="product-name">Card 2</h3>
          </div>
        </section>
      `;
      const title1 = document.querySelector('.featured-products .product-name')!;
      const selector = generateBestSelector(title1);
      expect(selector).toContain('featured-products');
      expect(document.querySelector(selector)).toBe(title1);
    });
  });

  describe('generateSelectorCandidates', () => {
    it('generates multiple evaluated candidates ranked by confidence', () => {
      document.body.innerHTML = `
        <div id="catalog-section">
          <article class="product-item" data-testid="product-item-123">
            <h2 class="product-title" aria-label="Keyboard Title">Keyboard</h2>
          </article>
        </div>
      `;
      const title = document.querySelector('.product-title')!;
      const candidates = generateSelectorCandidates(title);
      expect(candidates.length).toBeGreaterThan(1);
      const topCandidate = candidates[0];
      expect(topCandidate.isUnique).toBe(true);
      expect(topCandidate.matchCount).toBe(1);
    });
  });

  describe('generateXPath', () => {
    it('generates valid XPath expression for an element', () => {
      document.body.innerHTML = `
        <main>
          <div id="details">
            <span class="price-value">$49.99</span>
          </div>
        </main>
      `;
      const price = document.querySelector('.price-value')!;
      const xpath = generateXPath(price);
      expect(xpath).toBeDefined();
      expect(xpath.toLowerCase()).toContain('span');
    });
  });
});

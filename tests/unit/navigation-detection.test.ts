import { describe, it, expect, beforeEach } from 'vitest';
import {
  detectPagination,
  findNextPageControl,
  findLoadMoreControl,
  detectUrlPagination,
  isControlDisabled,
  isArbitraryNonPaginationButton,
} from '@/core/navigation/detector';

describe('Pagination & Navigation Control Detection', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Next-Page Discovery', () => {
    it('detects a next link using rel="next"', () => {
      document.body.innerHTML = `
        <div class="pagination">
          <a href="/page/1">1</a>
          <a rel="next" href="/page/2">2</a>
        </div>
      `;
      const control = findNextPageControl(document);
      expect(control).not.toBeNull();
      expect(control?.isAnchor).toBe(true);
      expect(control?.href).toContain('/page/2');
      expect(control?.strategy).toBe('next_link');
      expect(control?.confidence).toBeGreaterThanOrEqual(0.9);
      expect(control?.isDisabled).toBe(false);
    });

    it('detects next page control via aria-label with case insensitivity', () => {
      document.body.innerHTML = `
        <div>
          <button aria-label="Go to next page" class="nav-btn">Forward</button>
        </div>
      `;
      const control = findNextPageControl(document);
      expect(control).not.toBeNull();
      expect(control?.isAnchor).toBe(false);
      expect(control?.confidence).toBeGreaterThanOrEqual(0.8);
      expect(control?.isDisabled).toBe(false);
    });

    it('detects next page control via common text labels ("Next", "Next Page", ">", "»")', () => {
      const variants = [
        '<button class="next">Next &gt;</button>',
        '<a href="/p/2">Next Page</a>',
        '<button>»</button>',
        '<a href="/p/2">Older Posts →</a>',
      ];

      for (const html of variants) {
        document.body.innerHTML = html;
        const control = findNextPageControl(document);
        expect(control).not.toBeNull();
        expect(control?.strategy).toBe('next_link');
      }
    });

    it('detects next page via active pagination sibling item', () => {
      document.body.innerHTML = `
        <ul class="pagination">
          <li class="prev"><a href="/p/1">Prev</a></li>
          <li class="active"><span class="current">2</span></li>
          <li class="page-num"><a href="/p/3">3</a></li>
          <li class="page-num"><a href="/p/4">4</a></li>
        </ul>
      `;
      const control = findNextPageControl(document);
      expect(control).not.toBeNull();
      expect(control?.href).toContain('/p/3');
    });

    it('recognizes when next button is disabled via attributes or classes', () => {
      document.body.innerHTML = `
        <div>
          <button id="btn1" disabled>Next</button>
          <a id="btn2" aria-disabled="true" href="#">Next</a>
          <div id="btn3" class="btn disabled" role="button">Next</div>
          <button id="btn4" class="btn is-disabled">Next</button>
        </div>
      `;
      const btn1 = document.getElementById('btn1')!;
      const btn2 = document.getElementById('btn2')!;
      const btn3 = document.getElementById('btn3')!;
      const btn4 = document.getElementById('btn4')!;

      expect(isControlDisabled(btn1)).toBe(true);
      expect(isControlDisabled(btn2)).toBe(true);
      expect(isControlDisabled(btn3)).toBe(true);
      expect(isControlDisabled(btn4)).toBe(true);
    });
  });

  describe('Load-More Button Detection', () => {
    it('detects load more buttons with specific text heuristics', () => {
      const labels = [
        'Load More Products',
        'Show More Results',
        'View More Items',
        'Load More',
        'Show more',
      ];

      for (const text of labels) {
        document.body.innerHTML = `<div><button id="test-btn">${text}</button></div>`;
        const control = findLoadMoreControl(document);
        expect(control).not.toBeNull();
        expect(control?.strategy).toBe('load_more');
        expect(control?.text.toLowerCase()).toContain('more');
      }
    });

    it('rejects non-pagination action buttons so it never clicks arbitrary buttons', () => {
      const arbitraryButtons = [
        '<button>Add to Cart</button>',
        '<button>Buy Now</button>',
        '<button>Submit Order</button>',
        '<button>Delete Item</button>',
        '<button>Filter Results</button>',
        '<button>Search</button>',
        '<button>Sign In</button>',
        '<button>Subscribe to Newsletter</button>',
        '<button>Apply Coupon</button>',
      ];

      for (const html of arbitraryButtons) {
        document.body.innerHTML = html;
        const btn = document.querySelector('button')!;
        expect(isArbitraryNonPaginationButton(btn)).toBe(true);
        expect(findNextPageControl(document)).toBeNull();
        expect(findLoadMoreControl(document)).toBeNull();
      }
    });
  });

  describe('URL Pagination Detection', () => {
    it('detects query parameter page increments (?page=1, ?p=2, ?offset=20)', () => {
      const pattern1 = detectUrlPagination('https://example.com/items?page=1&sort=desc');
      expect(pattern1).not.toBeNull();
      expect(pattern1?.paramName).toBe('page');
      expect(pattern1?.currentPage).toBe(1);
      expect(pattern1?.nextPage).toBe(2);
      expect(pattern1?.template).toContain('{page}');

      const pattern2 = detectUrlPagination('https://example.com/search?q=shoes&p=3');
      expect(pattern2).not.toBeNull();
      expect(pattern2?.paramName).toBe('p');
      expect(pattern2?.currentPage).toBe(3);
      expect(pattern2?.nextPage).toBe(4);
    });

    it('detects path-based page patterns (/page/2/, /p/3)', () => {
      const pattern = detectUrlPagination('https://example.com/category/tech/page/2');
      expect(pattern).not.toBeNull();
      expect(pattern?.currentPage).toBe(2);
      expect(pattern?.nextPage).toBe(3);
      expect(pattern?.template).toBe('https://example.com/category/tech/page/{page}');
    });

    it('returns null when URL has no pagination pattern', () => {
      expect(detectUrlPagination('https://example.com/products')).toBeNull();
      expect(detectUrlPagination('https://example.com/about-us')).toBeNull();
    });
  });

  describe('Unified Pagination Detection', () => {
    it('returns recommendedStrategy=load_more when load more button is present', () => {
      document.body.innerHTML = `
        <div class="results">
          <div class="item">Item 1</div>
          <div class="item">Item 2</div>
        </div>
        <button id="load-more-btn" class="load-more">Load More Items</button>
      `;

      const result = detectPagination(document, 'https://example.com/items');
      expect(result.recommendedStrategy).toBe('load_more');
      expect(result.controls.length).toBeGreaterThan(0);
      expect(result.controls[0].strategy).toBe('load_more');
    });

    it('returns recommendedStrategy=next_link when Next link is present', () => {
      document.body.innerHTML = `
        <div class="pagination">
          <a rel="next" href="/items?page=2">Next Page &gt;</a>
        </div>
      `;

      const result = detectPagination(document, 'https://example.com/items?page=1');
      expect(result.recommendedStrategy).toBe('next_link');
      expect(result.controls[0].strategy).toBe('next_link');
    });

    it('falls back to url_pagination if no button exists but URL is paginated', () => {
      document.body.innerHTML = `<div class="items"><span>Item</span></div>`;
      const result = detectPagination(document, 'https://example.com/products?page=2');
      expect(result.recommendedStrategy).toBe('url_pagination');
      expect(result.urlPattern?.currentPage).toBe(2);
    });
  });
});

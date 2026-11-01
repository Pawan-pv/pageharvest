import { describe, it, expect, beforeEach } from 'vitest';
import {
  detectListFromSelection,
  updateFieldMapping,
} from '@/core/detection';
import { DetectionOptions } from '@/types/detection';

describe('Repeated List Detection & Field Discovery Engine', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('1. Product Grid Detection', () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <div class="shop-page">
          <div class="product-grid" data-testid="products">
            <div class="product-card" data-id="p1">
              <a href="/item/1" class="product-link">
                <img class="product-image" src="https://img.example.com/1.jpg" alt="Wireless Headset" />
                <h3 class="product-name">Wireless Noise-Canceling Headset</h3>
              </a>
              <div class="price-wrapper">
                <span class="product-price">$99.99</span>
                <span class="old-price">$129.99</span>
              </div>
              <div class="rating-box" aria-label="Rating: 4.7 out of 5 stars">
                <span class="stars">★★★★★</span>
                <span class="rating-text">4.7</span>
              </div>
              <button class="add-cart-btn" type="button">Add to Cart</button>
            </div>

            <div class="product-card" data-id="p2">
              <a href="/item/2" class="product-link">
                <img class="product-image" src="https://img.example.com/2.jpg" alt="Mechanical Keyboard" />
                <h3 class="product-name">Mechanical Gaming Keyboard RGB</h3>
              </a>
              <div class="price-wrapper">
                <span class="product-price">$149.50</span>
              </div>
              <div class="rating-box" aria-label="Rating: 4.8 out of 5 stars">
                <span class="stars">★★★★★</span>
                <span class="rating-text">4.8</span>
              </div>
              <button class="add-cart-btn" type="button">Add to Cart</button>
            </div>

            <div class="product-card" data-id="p3">
              <a href="/item/3" class="product-link">
                <img class="product-image" src="https://img.example.com/3.jpg" alt="Ergonomic Mouse" />
                <h3 class="product-name">Ergonomic Vertical Mouse</h3>
              </a>
              <div class="price-wrapper">
                <span class="product-price">$49.00</span>
                <span class="old-price">$59.00</span>
              </div>
              <div class="rating-box" aria-label="Rating: 4.5 out of 5 stars">
                <span class="stars">★★★★☆</span>
                <span class="rating-text">4.5</span>
              </div>
              <button class="add-cart-btn" type="button">Add to Cart</button>
            </div>
          </div>
        </div>
      `;
    });

    it('identifies enclosing list when a nested element (product name) is selected', () => {
      const selectedEl = document.querySelector('.product-name')!;
      const result = detectListFromSelection(selectedEl);

      expect(result).not.toBeNull();
      expect(result?.itemCount).toBe(3);
      expect(result?.name).toMatch(/product/i);
      expect(result?.confidence).toBeGreaterThanOrEqual(0.85);
      expect(result?.confidencePercent).toBeGreaterThanOrEqual(85);
    });

    it('discovers all product card fields with proper types and sample values', () => {
      const selectedEl = document.querySelector('.product-card')!;
      const result = detectListFromSelection(selectedEl);

      expect(result).not.toBeNull();
      const fields = result?.availableFields || [];

      const nameField = fields.find((f) => f.name.toLowerCase().includes('name') || f.name.toLowerCase().includes('title'));
      const priceField = fields.find((f) => f.type === 'price');
      const imgField = fields.find((f) => f.type === 'image');
      const ratingField = fields.find((f) => f.type === 'rating');
      const urlField = fields.find((f) => f.type === 'link');
      const buttonField = fields.find((f) => f.type === 'button');

      expect(nameField).toBeDefined();
      expect(priceField).toBeDefined();
      expect(priceField?.sampleValue).toBe('99.99');
      expect(imgField).toBeDefined();
      expect(imgField?.sampleValue).toContain('img.example.com');
      expect(ratingField).toBeDefined();
      expect(urlField).toBeDefined();
      expect(buttonField).toBeDefined();
      expect(buttonField?.sampleValue).toMatch(/add to cart/i);
    });

    it('provides transparent confidence score factors', () => {
      const selectedEl = document.querySelector('.product-card')!;
      const result = detectListFromSelection(selectedEl);

      expect(result).not.toBeNull();
      const factors = result?.confidenceFactors;
      expect(factors).toBeDefined();
      expect(factors?.structural).toBeGreaterThan(0);
      expect(factors?.frequency).toBeGreaterThan(0);
      expect(factors?.semantic).toBeGreaterThan(0);
      expect(factors?.fieldPatterns).toBeGreaterThan(0);
      expect(factors?.total).toBeCloseTo(result?.confidence || 0, 2);
    });
  });

  describe('2. Job Listings Detection', () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <div class="job-board">
          <div class="job-list" role="feed">
            <article class="job-item" data-id="j1">
              <h2 class="title"><a href="/jobs/1" class="apply-link">Senior Fullstack Engineer</a></h2>
              <span class="company">Acme Systems</span>
              <span class="location">Remote</span>
              <span class="salary">$140k - $160k</span>
              <time datetime="2026-10-01" class="posted">3 days ago</time>
              <button class="apply-btn">Apply Now</button>
            </article>
            <article class="job-item" data-id="j2">
              <h2 class="title"><a href="/jobs/2" class="apply-link">Staff Backend Architect</a></h2>
              <span class="company">DataCorp</span>
              <span class="location">San Francisco, CA</span>
              <span class="salary">$180k - $210k</span>
              <time datetime="2026-10-02" class="posted">2 days ago</time>
              <button class="apply-btn">Apply Now</button>
            </article>
            <article class="job-item" data-id="j3">
              <h2 class="title"><a href="/jobs/3" class="apply-link">DevOps Specialist</a></h2>
              <span class="company">CloudNative</span>
              <span class="location">Austin, TX</span>
              <span class="salary">$130k - $150k</span>
              <time datetime="2026-10-03" class="posted">1 day ago</time>
              <button class="apply-btn">Apply Now</button>
            </article>
          </div>
        </div>
      `;
    });

    it('detects job listings and names list as Job listings', () => {
      const selected = document.querySelector('.company')!;
      const result = detectListFromSelection(selected);

      expect(result).not.toBeNull();
      expect(result?.itemCount).toBe(3);
      expect(result?.name).toMatch(/job/i);

      const fields = result?.availableFields || [];
      const titleField = fields.find((f) => f.name.toLowerCase().includes('title'));
      const salaryField = fields.find((f) => f.type === 'price');
      const dateField = fields.find((f) => f.type === 'date');
      const buttonField = fields.find((f) => f.type === 'button');

      expect(titleField).toBeDefined();
      expect(salaryField).toBeDefined();
      expect(dateField).toBeDefined();
      expect(buttonField).toBeDefined();
    });
  });

  describe('3. Article Cards & News Feed Detection', () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <section class="blog-section">
          <div class="articles-grid">
            <article class="post-card">
              <img src="/thumb1.jpg" alt="AI in 2026" class="thumbnail" />
              <h2 class="headline"><a href="/post/1" class="link">State of Agentic Systems</a></h2>
              <p class="excerpt">A deep dive into multi-agent systems and deterministic DOM extraction.</p>
              <span class="author">By Jane Doe</span>
              <time datetime="2026-01-15" class="published-at">January 15, 2026</time>
            </article>
            <article class="post-card">
              <img src="/thumb2.jpg" alt="TypeScript 5" class="thumbnail" />
              <h2 class="headline"><a href="/post/2" class="link">TypeScript Best Practices</a></h2>
              <p class="excerpt">How strict typing and contracts prevent regressions in large extensions.</p>
              <span class="author">By John Smith</span>
              <time datetime="2026-01-18" class="published-at">January 18, 2026</time>
            </article>
            <article class="post-card">
              <img src="/thumb3.jpg" alt="Web Extension MV3" class="thumbnail" />
              <h2 class="headline"><a href="/post/3" class="link">Mastering Chrome Side Panels</a></h2>
              <p class="excerpt">Techniques for bi-directional communication between panel and tabs.</p>
              <span class="author">By Sarah Connor</span>
              <time datetime="2026-01-22" class="published-at">January 22, 2026</time>
            </article>
          </div>
        </section>
      `;
    });

    it('detects article cards with excerpt, author, and date', () => {
      const headline = document.querySelector('.headline')!;
      const result = detectListFromSelection(headline);

      expect(result).not.toBeNull();
      expect(result?.itemCount).toBe(3);
      expect(result?.name).toMatch(/article|post|card/i);

      const fields = result?.availableFields || [];
      const dateField = fields.find((f) => f.type === 'date');
      const excerptField = fields.find((f) => f.name.toLowerCase().includes('description') || f.name.toLowerCase().includes('excerpt'));

      expect(dateField).toBeDefined();
      expect(excerptField).toBeDefined();
    });
  });

  describe('4. Business Directories Detection', () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <div class="directory-list">
          <div class="listing-item" data-id="biz-1">
            <h3 class="biz-name"><a href="/biz/1" class="website">Trattoria Bella</a></h3>
            <span class="rating">4.8 (350 reviews)</span>
            <span class="category">Italian Restaurant</span>
            <span class="address">123 Main St, New York, NY</span>
            <span class="phone">(212) 555-0199</span>
          </div>
          <div class="listing-item" data-id="biz-2">
            <h3 class="biz-name"><a href="/biz/2" class="website">Sushi Ginza</a></h3>
            <span class="rating">4.9 (420 reviews)</span>
            <span class="category">Japanese Restaurant</span>
            <span class="address">456 Park Ave, New York, NY</span>
            <span class="phone">(212) 555-0288</span>
          </div>
          <div class="listing-item" data-id="biz-3">
            <h3 class="biz-name"><a href="/biz/3" class="website">Cafe De Paris</a></h3>
            <span class="rating">4.6 (180 reviews)</span>
            <span class="category">French Bistro</span>
            <span class="address">789 Broadway, New York, NY</span>
            <span class="phone">(212) 555-0377</span>
          </div>
        </div>
      `;
    });

    it('identifies directory listings and extracts rating, category, and phone', () => {
      const bizName = document.querySelector('.biz-name')!;
      const result = detectListFromSelection(bizName);

      expect(result).not.toBeNull();
      expect(result?.itemCount).toBe(3);

      const fields = result?.availableFields || [];
      const ratingField = fields.find((f) => f.type === 'rating');
      const linkField = fields.find((f) => f.type === 'link');

      expect(ratingField).toBeDefined();
      expect(linkField).toBeDefined();
    });
  });

  describe('5. Table Layout Detection', () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <table class="data-table">
          <thead>
            <tr><th>SKU</th><th>Product</th><th>Price</th><th>Stock</th></tr>
          </thead>
          <tbody>
            <tr class="data-row">
              <td class="col-sku">SKU-001</td>
              <td class="col-name">Ergonomic Mouse</td>
              <td class="col-price">$45.00</td>
              <td class="col-stock">150</td>
            </tr>
            <tr class="data-row">
              <td class="col-sku">SKU-002</td>
              <td class="col-name">Mechanical Keyboard</td>
              <td class="col-price">$120.00</td>
              <td class="col-stock">80</td>
            </tr>
            <tr class="data-row">
              <td class="col-sku">SKU-003</td>
              <td class="col-name">USB-C Hub</td>
              <td class="col-price">$35.00</td>
              <td class="col-stock">200</td>
            </tr>
          </tbody>
        </table>
      `;
    });

    it('detects table rows as repeated items with high confidence', () => {
      const cell = document.querySelector('.col-name')!;
      const result = detectListFromSelection(cell);

      expect(result).not.toBeNull();
      expect(result?.itemCount).toBe(3);
      expect(result?.name).toMatch(/table|row/i);
      expect(result?.confidence).toBeGreaterThanOrEqual(0.85);
    });
  });

  describe('6. Nested Structures', () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <div class="bundle-catalog">
          <div class="bundle-card">
            <h2 class="bundle-title">Office Bundle A</h2>
            <div class="bundle-items">
              <div class="sub-item"><span class="item-name">Keyboard</span><span class="sub-price">$50</span></div>
              <div class="sub-item"><span class="item-name">Mouse</span><span class="sub-price">$30</span></div>
            </div>
          </div>
          <div class="bundle-card">
            <h2 class="bundle-title">Gaming Bundle B</h2>
            <div class="bundle-items">
              <div class="sub-item"><span class="item-name">Headset</span><span class="sub-price">$80</span></div>
              <div class="sub-item"><span class="item-name">Controller</span><span class="sub-price">$60</span></div>
            </div>
          </div>
        </div>
      `;
    });

    it('detects outer cards when outer element is clicked', () => {
      const outerTitle = document.querySelector('.bundle-title')!;
      const result = detectListFromSelection(outerTitle);

      expect(result).not.toBeNull();
      expect(result?.itemCount).toBe(2);
      expect(result?.itemSelector).toContain('bundle-card');
    });

    it('detects inner nested items when an inner item is clicked', () => {
      const innerName = document.querySelector('.item-name')!;
      const result = detectListFromSelection(innerName);

      expect(result).not.toBeNull();
      // Should match the 2 sub-items in the first bundle or all 4 sub-items
      expect(result?.itemSelector).toContain('sub-item');
      expect(result?.itemCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('7. Missing Fields Handling', () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <div class="product-list">
          <div class="card">
            <h3 class="title">Product 1</h3>
            <span class="price">$10</span>
            <img class="pic" src="/1.jpg" alt="1" />
          </div>
          <div class="card">
            <h3 class="title">Product 2</h3>
            <!-- missing price -->
            <img class="pic" src="/2.jpg" alt="2" />
          </div>
          <div class="card">
            <h3 class="title">Product 3</h3>
            <span class="price">$30</span>
            <!-- missing image -->
          </div>
          <div class="card">
            <h3 class="title">Product 4</h3>
            <span class="price">$40</span>
            <img class="pic" src="/4.jpg" alt="4" />
          </div>
        </div>
      `;
    });

    it('detects list despite missing fields and calculates accurate field coverage', () => {
      const card = document.querySelector('.card')!;
      const result = detectListFromSelection(card);

      expect(result).not.toBeNull();
      expect(result?.itemCount).toBe(4);

      const priceField = result?.availableFields.find((f) => f.type === 'price');
      expect(priceField).toBeDefined();
      expect(priceField?.occurrences).toBe(3);
      expect(priceField?.coverage).toBe(0.75); // 3 out of 4 cards have price
    });
  });

  describe('8. Similar But Unrelated Elements Isolation', () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <div class="page-body">
          <main class="primary-feed">
            <div class="feed-grid">
              <div class="feed-card"><h2 class="card-title">Main Card 1</h2><span class="val">$100</span></div>
              <div class="feed-card"><h2 class="card-title">Main Card 2</h2><span class="val">$200</span></div>
              <div class="feed-card"><h2 class="card-title">Main Card 3</h2><span class="val">$300</span></div>
            </div>
          </main>
          <aside class="sidebar">
            <div class="widget">
              <ul class="nav-links">
                <li><a href="/a">Link A</a></li>
                <li><a href="/b">Link B</a></li>
              </ul>
            </div>
          </aside>
        </div>
      `;
    });

    it('isolates target list without including sidebar links or unrelated siblings', () => {
      const title = document.querySelector('.card-title')!;
      const result = detectListFromSelection(title);

      expect(result).not.toBeNull();
      expect(result?.itemCount).toBe(3);
      for (const el of result?.matchedElements || []) {
        expect(el.classList.contains('feed-card')).toBe(true);
        expect(el.tagName.toLowerCase()).not.toBe('li');
      }
    });
  });

  describe('9. Large DOM Performance & Bounded Scanning', () => {
    beforeEach(() => {
      const container = document.createElement('div');
      container.className = 'mega-grid';

      // Inject 1,000 items
      const itemsHtml: string[] = [];
      for (let i = 0; i < 1000; i++) {
        itemsHtml.push(`
          <div class="item-row" data-idx="${i}">
            <h4 class="item-title">Item #${i}</h4>
            <span class="item-price">$${(i * 1.5).toFixed(2)}</span>
            <a href="/item/${i}" class="item-link">Link</a>
          </div>
        `);
      }
      container.innerHTML = itemsHtml.join('');
      document.body.appendChild(container);
    });

    it('scans 1,000 elements efficiently in under 150ms using bounded sampling and caching', () => {
      const sample = document.querySelector('.item-title')!;
      const startTime = performance.now();

      const result = detectListFromSelection(sample, { sampleLimit: 10 });
      const durationMs = performance.now() - startTime;

      expect(result).not.toBeNull();
      expect(result?.itemCount).toBe(1000);
      expect(durationMs).toBeLessThan(150);
    });
  });

  describe('10. Custom Field Mappings & Heuristics', () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <div class="crypto-feed">
          <div class="coin-card">
            <span class="coin-symbol">BTC/USD</span>
            <span class="coin-price">$65,420.00</span>
          </div>
          <div class="coin-card">
            <span class="coin-symbol">ETH/USD</span>
            <span class="coin-price">$3,450.00</span>
          </div>
        </div>
      `;
    });

    it('allows updating field names and selector mappings', () => {
      const card = document.querySelector('.coin-card')!;
      const result = detectListFromSelection(card);

      expect(result).not.toBeNull();
      const firstField = result?.availableFields[0];
      expect(firstField).toBeDefined();

      const updated = updateFieldMapping(result!, firstField!.id, {
        name: 'Ticker Symbol',
        selector: '.coin-symbol',
      });

      const modifiedField = updated.availableFields.find((f) => f.id === firstField!.id);
      expect(modifiedField?.name).toBe('Ticker Symbol');
      expect(modifiedField?.selector).toBe('.coin-symbol');
    });

    it('supports custom configurable heuristics', () => {
      const card = document.querySelector('.coin-card')!;
      const options: DetectionOptions = {
        heuristics: {
          customRules: [
            {
              name: 'Crypto Ticker',
              type: 'text',
              extractor: 'text',
              selectors: ['.coin-symbol'],
              weight: 0.9,
            },
          ],
        },
      };

      const result = detectListFromSelection(card, options);
      expect(result).not.toBeNull();
      const tickerField = result?.availableFields.find((f) => f.name === 'Crypto Ticker');
      expect(tickerField).toBeDefined();
    });
  });
});

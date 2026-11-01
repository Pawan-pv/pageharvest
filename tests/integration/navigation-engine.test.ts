import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runMultiPageExtraction } from '@/core/navigation/engine';
import { FieldDefinition } from '@/types';

describe('Multi-Page Extraction Engine Integration', () => {
  const fields: FieldDefinition[] = [
    { id: 'f1', name: 'title', selector: 'h2.title, h3.title, .title', extractor: 'text' },
    { id: 'f2', name: 'price', selector: '.price', extractor: 'number' },
  ];

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Standard Next-Button Pagination', () => {
    it('successfully extracts exactly 90 records across 4 pages (24, 24, 24, 18) and completes', async () => {
      // Setup 4 pages simulation
      const pageCounts = [24, 24, 24, 18];
      let currentPage = 1;

      function renderDom(pageNum: number) {
        currentPage = pageNum;
        const count = pageCounts[pageNum - 1];
        document.body.innerHTML = `
          <div id="catalog">
            ${Array.from({ length: count }, (_, i) => `
              <div class="product-card">
                <h2 class="title">Product P${pageNum}-${i + 1}</h2>
                <span class="price">$${(pageNum * 10 + i + 1)}.00</span>
              </div>
            `).join('')}
          </div>
          <div class="pagination">
            <button id="next-btn" ${pageNum === 4 ? 'disabled aria-disabled="true"' : ''}>Next Page</button>
          </div>
        `;

        const btn = document.getElementById('next-btn');
        if (btn && pageNum < 4) {
          btn.addEventListener('click', () => {
            renderDom(pageNum + 1);
          });
        }
      }

      renderDom(1);

      const progressHistory: number[] = [];

      const result = await runMultiPageExtraction({
        strategy: 'next_link',
        containerSelector: '.product-card',
        fields,
        controlSelector: '#next-btn',
        maxPages: 10,
        delayMs: 20,
        pageTimeoutMs: 1000,
        onProgress: (p) => {
          progressHistory.push(p.recordsExtracted);
        },
      });

      expect(result.success).toBe(true);
      expect(result.totalPages).toBe(4);
      expect(result.totalRecords).toBe(90);
      expect(result.stopReason).toBe('control_disabled_or_missing');
      expect(result.pages).toHaveLength(4);
      expect(result.pages[0].records).toHaveLength(24);
      expect(result.pages[1].records).toHaveLength(24);
      expect(result.pages[2].records).toHaveLength(24);
      expect(result.pages[3].records).toHaveLength(18);
      expect(progressHistory[progressHistory.length - 1]).toBe(90);
    });
  });

  describe('Load More Button Pagination', () => {
    it('appends records dynamically on click and terminates when button is disabled', async () => {
      let batch = 1;
      const maxBatches = 3;

      document.body.innerHTML = `
        <div id="feed">
          <div class="feed-item"><h3 class="title">Item 1</h3><span class="price">$10</span></div>
          <div class="feed-item"><h3 class="title">Item 2</h3><span class="price">$20</span></div>
        </div>
        <button id="load-more">Load More</button>
      `;

      const loadMoreBtn = document.getElementById('load-more')!;
      loadMoreBtn.addEventListener('click', () => {
        batch++;
        const feed = document.getElementById('feed')!;
        const el1 = document.createElement('div');
        el1.className = 'feed-item';
        el1.innerHTML = `<h3 class="title">Item ${batch * 2 - 1}</h3><span class="price">$${batch * 10}</span>`;
        const el2 = document.createElement('div');
        el2.className = 'feed-item';
        el2.innerHTML = `<h3 class="title">Item ${batch * 2}</h3><span class="price">$${batch * 10 + 5}</span>`;
        feed.appendChild(el1);
        feed.appendChild(el2);

        if (batch >= maxBatches) {
          loadMoreBtn.setAttribute('disabled', 'true');
        }
      });

      const result = await runMultiPageExtraction({
        strategy: 'load_more',
        containerSelector: '.feed-item',
        fields,
        controlSelector: '#load-more',
        maxPages: 10,
        delayMs: 25,
        pageTimeoutMs: 1000,
      });

      expect(result.success).toBe(true);
      expect(result.totalRecords).toBe(6);
      expect(result.totalPages).toBe(3);
      expect(result.stopReason).toBe('control_disabled_or_missing');
    });
  });

  describe('Infinite Scroll Strategy', () => {
    it('scrolls and extracts batches up to maxScrolls safety limit', async () => {
      let scrollIndex = 2;
      document.body.innerHTML = `
        <div id="scroll-list">
          <div class="card"><h3 class="title">Post 1</h3><span class="price">$5</span></div>
          <div class="card"><h3 class="title">Post 2</h3><span class="price">$10</span></div>
        </div>
      `;

      window.scrollBy = vi.fn(() => {
        // Append new items upon scroll
        if (scrollIndex < 6) {
          scrollIndex++;
          const card = document.createElement('div');
          card.className = 'card';
          card.innerHTML = `<h3 class="title">Post ${scrollIndex}</h3><span class="price">$${scrollIndex * 5}</span>`;
          document.getElementById('scroll-list')!.appendChild(card);
        }
      });

      const result = await runMultiPageExtraction({
        strategy: 'infinite_scroll',
        containerSelector: '.card',
        fields,
        maxScrolls: 3,
        scrollDelayMs: 20,
        pageTimeoutMs: 500,
      });

      expect(result.success).toBe(true);
      expect(result.totalRecords).toBeGreaterThanOrEqual(4);
      expect(result.stopReason).toBe('max_scrolls_reached');
    });
  });

  describe('Safety Limits & Circuit Breakers', () => {
    it('enforces maxPages strict ceiling', async () => {
      document.body.innerHTML = `
        <div class="list"><div class="item"><h3 class="title">X</h3><span class="price">$1</span></div></div>
        <button id="next">Next</button>
      `;

      const result = await runMultiPageExtraction({
        strategy: 'next_link',
        containerSelector: '.item',
        fields,
        controlSelector: '#next',
        maxPages: 2,
        delayMs: 10,
      });

      expect(result.totalPages).toBe(2);
      expect(result.stopReason).toBe('max_pages_reached');
    });

    it('halts when encountering consecutive empty batches', async () => {
      document.body.innerHTML = `
        <div id="empty-list"></div>
        <button id="next">Next</button>
      `;

      const result = await runMultiPageExtraction({
        strategy: 'next_link',
        containerSelector: '.item',
        fields,
        controlSelector: '#next',
        maxPages: 10,
        consecutiveEmptyLimit: 2,
        delayMs: 10,
      });

      expect(result.stopReason).toBe('empty_page_limit');
      expect(result.totalRecords).toBe(0);
    });

    it('deduplicates identical records across pages and halts if duplicates persist', async () => {
      // Every page returns the exact same record
      document.body.innerHTML = `
        <div class="list">
          <div class="item"><h3 class="title">Static Item</h3><span class="price">$9.99</span></div>
        </div>
        <button id="next">Next</button>
      `;

      const result = await runMultiPageExtraction({
        strategy: 'next_link',
        containerSelector: '.item',
        fields,
        controlSelector: '#next',
        maxPages: 10,
        consecutiveDuplicateLimit: 2,
        delayMs: 10,
      });

      expect(result.totalRecords).toBe(1);
      expect(result.duplicatesSkipped).toBeGreaterThanOrEqual(2);
      expect(result.stopReason).toBe('duplicate_page_limit');
    });

    it('prevents infinite loops when next button points to already visited URL', async () => {
      document.body.innerHTML = `
        <div class="list"><div class="item"><h3 class="title">Item 1</h3><span class="price">$1</span></div></div>
        <a id="next" href="https://example.com/loop">Next</a>
      `;

      let visitedCount = 0;
      const navigateMock = vi.fn().mockImplementation(async () => {
        visitedCount++;
        return true;
      });

      const result = await runMultiPageExtraction({
        strategy: 'next_link',
        containerSelector: '.item',
        fields,
        controlSelector: '#next',
        maxPages: 10,
        delayMs: 10,
        navigateUrl: navigateMock,
      });

      expect(result.stopReason).toBe('repeated_url');
    });
  });

  describe('Cancellation & Recovery', () => {
    it('stops immediately when AbortSignal triggers cancellation', async () => {
      const controller = new AbortController();

      document.body.innerHTML = `
        <div class="list"><div class="item"><h3 class="title">Item 1</h3><span class="price">$1</span></div></div>
        <button id="next">Next</button>
      `;

      // Cancel after 1st page
      setTimeout(() => {
        controller.abort();
      }, 30);

      const result = await runMultiPageExtraction({
        strategy: 'next_link',
        containerSelector: '.item',
        fields,
        controlSelector: '#next',
        maxPages: 10,
        delayMs: 100,
        signal: controller.signal,
      });

      expect(result.stopReason).toBe('cancelled');
      expect(result.totalPages).toBeGreaterThanOrEqual(1);
    });

    it('resumes a previous session using persisted session state', async () => {
      document.body.innerHTML = `
        <div class="list">
          <div class="item"><h3 class="title">Resumed Product</h3><span class="price">$50</span></div>
        </div>
      `;

      const previousState = {
        strategy: 'next_link' as const,
        currentPage: 3,
        totalExtracted: 48,
        duplicatesSkipped: 0,
        seenHashes: ['hash1', 'hash2'],
        visitedUrls: ['https://example.com/p1', 'https://example.com/p2'],
        lastUrl: 'https://example.com/p2',
        savedAt: Date.now(),
      };

      const result = await runMultiPageExtraction({
        strategy: 'next_link',
        containerSelector: '.item',
        fields,
        maxPages: 4,
        initialSessionState: previousState,
      });

      expect(result.totalPages).toBe(4);
      expect(result.totalRecords).toBe(49); // 48 previously + 1 new
      expect(result.stopReason).toBe('control_disabled_or_missing');
    });
  });

  describe('Manual User-Confirmed Navigation', () => {
    it('waits for manual user step trigger before proceeding to next page', async () => {
      let page = 1;
      document.body.innerHTML = `
        <div class="list"><div class="item"><h3 class="title">Manual Item 1</h3><span class="price">$10</span></div></div>
      `;

      const manualTrigger = vi.fn().mockImplementation(async () => {
        if (page < 2) {
          page++;
          document.body.innerHTML = `
            <div class="list"><div class="item"><h3 class="title">Manual Item 2</h3><span class="price">$20</span></div></div>
          `;
          return true; // proceed
        }
        return false; // stop
      });

      const result = await runMultiPageExtraction({
        strategy: 'manual',
        containerSelector: '.item',
        fields,
        maxPages: 5,
        manualStepTrigger: manualTrigger,
      });

      expect(result.totalPages).toBe(2);
      expect(result.totalRecords).toBe(2);
      expect(result.stopReason).toBe('manual_stop');
    });
  });
});

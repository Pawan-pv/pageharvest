import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMultiPageExtraction } from '@/core/navigation/engine';
import { FieldDefinition } from '@/types';

const fields: FieldDefinition[] = [{ id: 't', name: 'Title', selector: '.title', extractor: 'text' }];

function renderScrollFeed() {
  let next = 1;
  document.body.innerHTML = '<div id="feed"></div>';
  const feed = document.getElementById('feed') as HTMLElement;
  const append = () => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<h3 class="title">Post ${next}</h3>`;
    next += 1;
    feed.appendChild(card);
  };
  append();
  return vi.fn(() => append());
}

const fastScroll = { scrollDelayMs: 5, pageTimeoutMs: 200 };

describe('Scroll and page limits are independent', () => {
  let originalScrollBy: typeof window.scrollBy;

  beforeEach(() => {
    originalScrollBy = window.scrollBy;
  });

  afterEach(() => {
    window.scrollBy = originalScrollBy;
  });

  it('performs exactly maxScrolls scroll actions', async () => {
    const scrollBy = renderScrollFeed();
    window.scrollBy = scrollBy as unknown as typeof window.scrollBy;

    const result = await runMultiPageExtraction({
      strategy: 'infinite_scroll',
      containerSelector: '.card',
      fields,
      maxScrolls: 3,
      ...fastScroll,
    });

    expect(scrollBy).toHaveBeenCalledTimes(3);
    expect(result.stopReason).toBe('max_scrolls_reached');
    expect(result.totalRecords).toBe(4);
  });

  it('does not let a small maxPages cap a larger maxScrolls', async () => {
    const scrollBy = renderScrollFeed();
    window.scrollBy = scrollBy as unknown as typeof window.scrollBy;

    const result = await runMultiPageExtraction({
      strategy: 'infinite_scroll',
      containerSelector: '.card',
      fields,
      maxPages: 2,
      maxScrolls: 5,
      ...fastScroll,
    });

    expect(scrollBy).toHaveBeenCalledTimes(5);
    expect(result.stopReason).toBe('max_scrolls_reached');
  });

  it('does not let a small maxScrolls cap page navigation', async () => {
    let page = 1;
    const render = () => {
      document.body.innerHTML = `
        <div class="card"><h3 class="title">Page ${page}</h3></div>
        <button id="next">Next</button>
      `;
      document.getElementById('next')?.addEventListener('click', () => {
        page += 1;
        render();
      });
    };
    render();

    const result = await runMultiPageExtraction({
      strategy: 'next_link',
      containerSelector: '.card',
      fields,
      controlSelector: '#next',
      maxPages: 5,
      maxScrolls: 1,
      delayMs: 1,
      pageTimeoutMs: 200,
    });

    expect(result.totalPages).toBe(5);
    expect(result.stopReason).toBe('max_pages_reached');
  });

  it('stops an endless scroll feed that yields nothing new', async () => {
    document.body.innerHTML = '<div id="feed"><div class="card"><h3 class="title">Only</h3></div></div>';
    const scrollBy = vi.fn();
    window.scrollBy = scrollBy as unknown as typeof window.scrollBy;

    const result = await runMultiPageExtraction({
      strategy: 'infinite_scroll',
      containerSelector: '.card',
      fields,
      maxScrolls: 50,
      ...fastScroll,
    });

    expect(result.totalRecords).toBe(1);
    expect(scrollBy.mock.calls.length).toBeLessThan(5);
    expect(['empty_page_limit', 'duplicate_page_limit']).toContain(result.stopReason);
  });

  it('does not count unchanged on-page cards as duplicates on every scroll', async () => {
    const scrollBy = renderScrollFeed();
    window.scrollBy = scrollBy as unknown as typeof window.scrollBy;

    const result = await runMultiPageExtraction({
      strategy: 'infinite_scroll',
      containerSelector: '.card',
      fields,
      maxScrolls: 3,
      ...fastScroll,
    });

    expect(result.duplicatesSkipped).toBe(0);
  });

  it('does not count a late value update toward maxRecords', async () => {
    const lateFields: FieldDefinition[] = [
      { id: 't', name: 'Title', selector: '.title', extractor: 'text' },
      { id: 'p', name: 'Picture', selector: 'img', extractor: 'src' },
    ];
    document.body.innerHTML = `
      <div id="feed">
        <div class="card"><h3 class="title">Post 1</h3><img></div>
      </div>
    `;
    const feed = document.getElementById('feed') as HTMLElement;
    let scrollCount = 0;
    const scrollBy = vi.fn(() => {
      scrollCount++;
      if (scrollCount === 1) {
        feed.querySelector('img')?.setAttribute('src', '/post-1.jpg');
        return;
      }
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = '<h3 class="title">Post 2</h3><img src="/post-2.jpg">';
      feed.appendChild(card);
    });
    window.scrollBy = scrollBy as unknown as typeof window.scrollBy;

    const result = await runMultiPageExtraction({
      strategy: 'infinite_scroll',
      containerSelector: '.card',
      fields: lateFields,
      maxRecords: 2,
      maxScrolls: 3,
      scrollDelayMs: 1,
      pageTimeoutMs: 50,
      onPageExtracted: (batch) => ({
        inserted: batch.records.filter((record) => record._supersedes === undefined).length,
      }),
    });

    expect(scrollBy).toHaveBeenCalledTimes(2);
    expect(result.pages.at(-1)?.records[0]?.Title).toBe('Post 2');
    expect(result.resumableState?.totalExtracted).toBe(2);
    expect(result.stopReason).toBe('max_records_reached');
  });

  it('does not wait for new containers when an existing row changes after scrolling', async () => {
    const lateFields: FieldDefinition[] = [
      { id: 't', name: 'Title', selector: '.title', extractor: 'text' },
      { id: 'p', name: 'Picture', selector: 'img', extractor: 'src' },
    ];
    document.body.innerHTML = `
      <div id="feed">
        <div class="card"><h3 class="title">Post 1</h3><img></div>
      </div>
    `;
    const scrollBy = vi.fn(() => {
      document.querySelector('img')?.setAttribute('src', '/loaded.jpg');
    });
    window.scrollBy = scrollBy as unknown as typeof window.scrollBy;

    const startedAt = Date.now();
    const result = await runMultiPageExtraction({
      strategy: 'infinite_scroll',
      containerSelector: '.card',
      fields: lateFields,
      maxScrolls: 1,
      scrollDelayMs: 1,
      pageTimeoutMs: 200,
    });

    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(result.pages.at(-1)?.records[0]?.Picture).toBe('http://localhost:3000/loaded.jpg');
    expect(Date.now() - startedAt).toBeLessThan(450);
  });

  it('stops promptly when cancelled during a scroll delay', async () => {
    const scrollBy = renderScrollFeed();
    window.scrollBy = scrollBy as unknown as typeof window.scrollBy;
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);

    const startedAt = Date.now();
    const result = await runMultiPageExtraction({
      strategy: 'infinite_scroll',
      containerSelector: '.card',
      fields,
      maxScrolls: 100,
      scrollDelayMs: 5000,
      pageTimeoutMs: 200,
      signal: controller.signal,
    });

    expect(result.stopReason).toBe('cancelled');
    expect(Date.now() - startedAt).toBeLessThan(1500);
  });

  it('waits at the pause gate without scrolling', async () => {
    const scrollBy = renderScrollFeed();
    window.scrollBy = scrollBy as unknown as typeof window.scrollBy;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const run = runMultiPageExtraction({
      strategy: 'infinite_scroll',
      containerSelector: '.card',
      fields,
      maxScrolls: 2,
      ...fastScroll,
      waitWhilePaused: () => gate,
    });

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(scrollBy).not.toHaveBeenCalled();

    release();
    const result = await run;
    expect(scrollBy).toHaveBeenCalledTimes(2);
    expect(result.stopReason).toBe('max_scrolls_reached');
  });
});

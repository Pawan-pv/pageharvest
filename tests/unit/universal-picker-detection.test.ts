/**
 * Universal Visual Picker & Site-Agnostic List Detection Test Suite (Archetypes A-F)
 *
 * Covers real-world DOM architectures using purely structural heuristics:
 *   A. Bidirectional Wrapper Selection (Drill-Down + Walk-Up)
 *   B. Multi-Chunk Containers with Duplicate IDs
 *   C. Nested Row-Wrapped Grids
 *   D. Framework-Hashed & Utility-Only Classes (CSS-in-JS / Tailwind / CSS Modules)
 *   E. Heterogeneous Feeds with Injected Promo / Ad Noise
 *   F. Explicit >= 2 Selector Confirm Fallback, Guaranteed Overlay Teardown, & Dock Clearance
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ElementPicker } from '@/content/picker/picker';
import { createContentWorkflowCoordinator } from '@/content/workflow-coordinator';
import { detectListFromSelection } from '@/core/detection';
import { generateCssSelector, isUniqueId, isVolatileOrUtilityClass } from '@/utils/selector';
import { generateSelectorCandidates } from '@/content/picker/selector-engine';
import { ListSetupView } from '@/components/list-extractor/ListSetupView';

function setHtml(html: string): void {
  document.body.innerHTML = html;
}

describe('Universal Visual Picker & Site-Agnostic Detection (Archetypes A-F)', () => {
  let picker: ElementPicker | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    picker?.stop();
    picker = null;
    document.getElementById('pageharvest-picker-overlay-host')?.remove();
    vi.restoreAllMocks();
  });

  it('Archetype A: discovers repeating cards when clicking an outer wrapper container', async () => {
    setHtml(`
      <main>
        <section class="catalog-shell" data-testid="catalog-wrapper">
          <header class="catalog-header"><h2>Featured Catalog</h2></header>
          <div class="catalog-grid">
            ${Array.from({ length: 6 }, (_, i) => `
              <article class="catalog-card">
                <a href="https://example.com/item-${i + 1}" class="card-link">
                  <h3 class="card-title">Studio Light ${i + 1}</h3>
                </a>
                <span class="card-price">$${100 + i * 25}</span>
              </article>
            `).join('')}
          </div>
        </section>
      </main>
    `);

    const wrapper = document.querySelector('[data-testid="catalog-wrapper"]')!;
    const detected = detectListFromSelection(wrapper);
    expect(detected).not.toBeNull();
    expect(detected!.itemCount).toBe(6);

    picker = new ElementPicker({ showToolbar: true, showSimilar: true });
    picker.start();
    wrapper.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const selected = picker.getSelectedInfo()!;
    expect(selected.matchCount).toBe(6);

    const coordinator = createContentWorkflowCoordinator(() => undefined, document);
    const res = await coordinator.detectRepeatedElements({
      id: 'det-a',
      type: 'DETECT_REPEATED_ELEMENTS',
      timestamp: Date.now(),
      payload: { targetSelector: selected.selector },
    });

    expect(res.payload.matchCount).toBe(6);
    expect(document.querySelectorAll(res.payload.containerSelector).length).toBe(6);
  });

  it('Archetype B: aggregates multi-chunk containers and rejects duplicate IDs', async () => {
    setHtml(`
      <main>
        ${[1, 2, 3].map((chunk) => `
          <article id="feed-chunk" data-testid="feed-chunk" class="feed-block">
            ${Array.from({ length: 6 }, (_, i) => `
              <div class="listing-card" data-component="listing-card">
                <h4 class="listing-title">Listing C${chunk}-${i + 1}</h4>
                <p class="listing-meta">Category ${(chunk + i) % 3}</p>
                <a href="/listing/${chunk}-${i + 1}">Open</a>
              </div>
            `).join('')}
          </article>
        `).join('')}
      </main>
    `);

    const dupIds = document.querySelectorAll('[id="feed-chunk"]');
    expect(dupIds.length).toBe(3);
    expect(isUniqueId('feed-chunk', document)).toBe(false);

    const firstChunk = dupIds[0];
    const chunkSelector = generateCssSelector(firstChunk);
    expect(chunkSelector).not.toContain('#feed-chunk');
    expect(document.querySelectorAll(chunkSelector).length).toBe(1);
    const chunkCandidates = generateSelectorCandidates(firstChunk);
    expect(chunkCandidates.some((c) => c.selector.includes('data-testid="feed-chunk"') && c.matchCount === 3)).toBe(true);

    const detected = detectListFromSelection(firstChunk);
    expect(detected).not.toBeNull();
    expect(detected!.itemCount).toBe(18);
    expect(detected!.containerSelector).not.toContain('#feed-chunk');

    const coordinator = createContentWorkflowCoordinator(() => undefined, document);
    const innerTitle = document.querySelector('.listing-title')!;
    const innerSelector = generateCssSelector(innerTitle);
    const res = await coordinator.detectRepeatedElements({
      id: 'det-b',
      type: 'DETECT_REPEATED_ELEMENTS',
      timestamp: Date.now(),
      payload: { targetSelector: innerSelector },
    });

    expect(res.payload.matchCount).toBe(18);
  });

  it('Archetype C: drills past row wrappers to find all inner cards across rows', async () => {
    setHtml(`
      <main>
        <section class="results-board">
          ${Array.from({ length: 6 }, (_, row) => `
            <div class="results-row">
              ${Array.from({ length: 3 }, (_, col) => `
                <article class="result-tile">
                  <h3 class="tile-heading">Result R${row + 1}C${col + 1}</h3>
                  <span class="tile-badge">$${40 + row * 5 + col}</span>
                  <a href="/r/${row + 1}/${col + 1}" class="tile-cta">Details</a>
                </article>
              `).join('')}
            </div>
          `).join('')}
        </section>
      </main>
    `);

    const firstRow = document.querySelector('.results-row')!;
    const detected = detectListFromSelection(firstRow);
    expect(detected).not.toBeNull();
    expect(detected!.itemCount).toBe(18);

    const firstTile = document.querySelector('.result-tile')!;
    const fromTile = detectListFromSelection(firstTile);
    expect(fromTile).not.toBeNull();
    expect(fromTile!.itemCount).toBe(18);
  });

  it('Archetype D: strips CSS-in-JS, CSS module, and Tailwind utility classes cleanly', () => {
    expect(isVolatileOrUtilityClass('css-1a2b3c')).toBe(true);
    expect(isVolatileOrUtilityClass('sc-f8e9d0')).toBe(true);
    expect(isVolatileOrUtilityClass('Card_root__aB9x2')).toBe(true);
    expect(isVolatileOrUtilityClass('flex-col')).toBe(true);
    expect(isVolatileOrUtilityClass('hover:bg-blue-500')).toBe(true);
    expect(isVolatileOrUtilityClass('product-card')).toBe(false);

    setHtml(`
      <div class="jsx-998877 grid grid-cols-3 gap-4" data-component="directory-feed">
        ${Array.from({ length: 5 }, (_, i) => `
          <div class="css-1a2b3c sc-d4e5f6 p-4 rounded-lg flex flex-col gap-2 bg-white" data-testid="dir-card">
            <h3 class="Heading_title__Zx91 text-lg font-bold">Vendor ${i + 1}</h3>
            <span class="text-sm text-gray-500">$${20 + i}/mo</span>
            <a class="hover:underline text-blue-600" href="/v/${i + 1}">Visit</a>
          </div>
        `).join('')}
      </div>
    `);

    const card = document.querySelector('[data-testid="dir-card"]')!;
    const candidates = generateSelectorCandidates(card);
    for (const c of candidates) {
      expect(c.selector).not.toMatch(/css-1a2b3c|sc-d4e5f6|Heading_title__Zx91/);
      expect(c.selector).not.toMatch(/\.(?:p-4|flex|gap-2|bg-white)\b/);
    }

    const detected = detectListFromSelection(card);
    expect(detected).not.toBeNull();
    expect(detected!.itemCount).toBe(5);
    expect(detected!.itemSelector).toContain('data-testid="dir-card"');
  });

  it('Archetype E: isolates repeating records while excluding interspersed promo and ad slots', async () => {
    setHtml(`
      <main>
        <div class="search-stream" data-testid="search-stream">
          <div class="job-row"><h3 class="role">Frontend Engineer</h3><span class="pay">$140k</span><a href="/j/1">Apply</a></div>
          <div class="job-row"><h3 class="role">Backend Engineer</h3><span class="pay">$150k</span><a href="/j/2">Apply</a></div>
          <aside class="promo-banner" data-ad="sponsored-banner"><strong>Upgrade Pro</strong></aside>
          <div class="job-row"><h3 class="role">Systems Engineer</h3><span class="pay">$160k</span><a href="/j/3">Apply</a></div>
          <div class="job-row"><h3 class="role">Security Engineer</h3><span class="pay">$165k</span><a href="/j/4">Apply</a></div>
          <div class="promo-banner"><span>Sponsored Webinar</span></div>
          <div class="job-row"><h3 class="role">Platform Engineer</h3><span class="pay">$155k</span><a href="/j/5">Apply</a></div>
          <div class="job-row"><h3 class="role">QA Engineer</h3><span class="pay">$130k</span><a href="/j/6">Apply</a></div>
        </div>
      </main>
    `);

    const stream = document.querySelector('[data-testid="search-stream"]')!;
    const coordinator = createContentWorkflowCoordinator(() => undefined, document);
    const res = await coordinator.detectRepeatedElements({
      id: 'det-e',
      type: 'DETECT_REPEATED_ELEMENTS',
      timestamp: Date.now(),
      payload: { targetSelector: '[data-testid="search-stream"]' },
    });

    expect(res.payload.matchCount).toBe(6);
    const matched = Array.from(document.querySelectorAll(res.payload.containerSelector));
    expect(matched).toHaveLength(6);
    expect(matched.some((el) => el.classList.contains('promo-banner'))).toBe(false);
    expect(stream.children.length).toBe(8);
  });

  it('Archetype F1: explicit selector matching >= 2 elements succeeds even without uniform structure or shared parent', async () => {
    setHtml(`
      <section>
        <div data-testid="hetero-slot"><span>Alpha only</span></div>
      </section>
      <aside>
        <div data-testid="hetero-slot"><img src="https://example.com/a.jpg" alt="B" /><b>Beta bold</b><p>Extra</p></div>
      </aside>
      <footer>
        <div data-testid="hetero-slot"><a href="https://example.com/c">Gamma link</a></div>
      </footer>
    `);

    const coordinator = createContentWorkflowCoordinator(() => undefined, document);
    const res = await coordinator.detectRepeatedElements({
      id: 'det-f',
      type: 'DETECT_REPEATED_ELEMENTS',
      timestamp: Date.now(),
      payload: { targetSelector: 'div[data-testid="hetero-slot"]' },
    });

    expect(res.payload.matchCount).toBe(3);
    expect(res.payload.containerSelector).toBe('div[data-testid="hetero-slot"]');
  });

  it('Archetype F2: overlay always tears down cleanly on Confirm, Cancel, Escape, and callback error', () => {
    setHtml(`<ul><li class="row">One</li><li class="row">Two</li><li class="row">Three</li></ul>`);

    // 1. Confirm tears down even if onConfirm throws
    picker = new ElementPicker({
      showToolbar: true,
      onConfirm: () => {
        throw new Error('Confirm handler boom');
      },
    });
    picker.start();
    document.querySelector('.row')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(document.getElementById('pageharvest-picker-overlay-host')).not.toBeNull();
    expect(() => picker!.confirm()).toThrow('Confirm handler boom');
    expect(document.getElementById('pageharvest-picker-overlay-host')).toBeNull();

    // 2. Cancel tears down even if onCancel throws
    picker = new ElementPicker({
      showToolbar: true,
      onCancel: () => {
        throw new Error('Cancel handler boom');
      },
    });
    picker.start();
    document.querySelector('.row')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(document.getElementById('pageharvest-picker-overlay-host')).not.toBeNull();
    expect(() => picker!.cancel()).toThrow('Cancel handler boom');
    expect(document.getElementById('pageharvest-picker-overlay-host')).toBeNull();

    // 3. Escape tears down overlay and removes stray duplicate host on redundant stop()
    picker = new ElementPicker({ showToolbar: true });
    picker.start();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.getElementById('pageharvest-picker-overlay-host')).toBeNull();

    const stray = document.createElement('div');
    stray.id = 'pageharvest-picker-overlay-host';
    document.body.appendChild(stray);
    picker.stop();
    expect(document.getElementById('pageharvest-picker-overlay-host')).toBeNull();
  });

  it('Archetype F3: ListSetupView renders Start Extraction CTA in non-sticky flow below Load More', () => {
    render(
      React.createElement(ListSetupView, {
        detectedList: {
          containerSelector: 'div.card',
          matchCount: 12,
          sampleSnippets: ['One', 'Two'],
        },
        fields: [
          {
            id: 'f1',
            name: 'Title',
            selector: '.title',
            extractor: 'text',
            required: false,
            transform: 'trim',
          },
        ],
        selectedFieldIds: new Set(['f1']),
        pagination: {
          type: 'next_button',
          nextButtonSelector: 'button.more',
          maxPages: 5,
          delayMs: 1500,
          scrollCount: 10,
          scrollDelayMs: 1500,
          startPage: 1,
          pageIncrement: 1,
        },
        onPickList: vi.fn(),
        onAutoDetect: vi.fn(),
        onRepick: vi.fn(),
        onPaginationChange: vi.fn(),
        onPickNextButton: vi.fn(),
        onStartExtraction: vi.fn(),
      })
    );

    const startBtn = screen.getByRole('button', { name: /start extraction/i });
    const ctaDock = startBtn.parentElement!;
    expect(ctaDock.className).not.toContain('sticky');
    const loadMoreRadio = screen.getByRole('radio', { name: /^Load More$/i });
    // CTA container comes strictly after Load More controls in DOM flow
    expect(Boolean(loadMoreRadio.compareDocumentPosition(ctaDock) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  findNextPageControl,
  isControlDisabled,
  performScrollStep,
  runMultiPageExtraction,
} from '@/core/navigation/runner';
import { FieldDefinition } from '@/types';

const fields: FieldDefinition[] = [{ id: 't', name: 'Title', selector: '.title', extractor: 'text' }];

describe('Navigation, Pagination & Infinite Scroll Runner', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('detects disabled buttons and links accurately', () => {
    const disabledBtn = document.createElement('button');
    disabledBtn.disabled = true;
    expect(isControlDisabled(disabledBtn)).toBe(true);

    const ariaDisabled = document.createElement('a');
    ariaDisabled.setAttribute('aria-disabled', 'true');
    expect(isControlDisabled(ariaDisabled)).toBe(true);

    const classDisabled = document.createElement('div');
    classDisabled.className = 'btn disabled';
    expect(isControlDisabled(classDisabled)).toBe(true);

    const normalBtn = document.createElement('button');
    expect(isControlDisabled(normalBtn)).toBe(false);
  });

  it('finds next button via rel="next"', () => {
    document.body.innerHTML = `
      <div class="pagination">
        <a href="/page/1">1</a>
        <a rel="next" href="/page/2">2</a>
      </div>
    `;

    const candidate = findNextPageControl(document);
    expect(candidate).not.toBeNull();
    expect(candidate?.isAnchor).toBe(true);
    expect(candidate?.href).toContain('/page/2');
    expect(candidate?.isDisabled).toBe(false);
  });

  it('finds next button via text content heuristic', () => {
    document.body.innerHTML = `
      <div class="pager">
        <button class="btn-prev">Previous</button>
        <button class="btn-next">Next &gt;</button>
      </div>
    `;

    const candidate = findNextPageControl(document);
    expect(candidate).not.toBeNull();
    expect(candidate?.element.className).toBe('btn-next');
    expect(candidate?.isAnchor).toBe(false);
  });

  it('finds next button using custom selector', () => {
    document.body.innerHTML = `
      <div>
        <a id="custom-load-more" href="/page/3">Load More Stories</a>
      </div>
    `;

    const candidate = findNextPageControl(document, '#custom-load-more');
    expect(candidate).not.toBeNull();
    expect(candidate?.element.id).toBe('custom-load-more');
    expect(candidate?.href).toContain('/page/3');
  });

  it('stops when the next button is disabled, without clicking it', async () => {
    document.body.innerHTML = `
      <div class="card"><h2 class="title">Only page</h2></div>
      <button class="next-btn" disabled>Next Page</button>
    `;
    const clickHandler = vi.fn();
    document.querySelector('.next-btn')?.addEventListener('click', clickHandler);

    const result = await runMultiPageExtraction({
      strategy: 'next_link',
      containerSelector: '.card',
      fields,
      controlSelector: '.next-btn',
      delayMs: 1,
      pageTimeoutMs: 100,
    });

    expect(result.stopReason).toBe('control_disabled_or_missing');
    expect(result.totalRecords).toBe(1);
    expect(clickHandler).not.toHaveBeenCalled();
  });

  it('clicks the next button once per page', async () => {
    let page = 1;
    const clickHandler = vi.fn();
    const render = () => {
      document.body.innerHTML = `
        <div class="card"><h2 class="title">Page ${page}</h2></div>
        <button id="next-page-btn" ${page === 2 ? 'disabled' : ''}>Next</button>
      `;
      document.getElementById('next-page-btn')?.addEventListener('click', () => {
        clickHandler();
        page += 1;
        render();
      });
    };
    render();

    const result = await runMultiPageExtraction({
      strategy: 'next_link',
      containerSelector: '.card',
      fields,
      controlSelector: '#next-page-btn',
      delayMs: 1,
      pageTimeoutMs: 100,
    });

    expect(clickHandler).toHaveBeenCalledTimes(1);
    expect(result.totalRecords).toBe(2);
  });

  it('treats an in-page "#" link as a control, not as a repeated URL', async () => {
    let page = 1;
    const render = () => {
      document.body.innerHTML = `
        <div class="card"><h2 class="title">Page ${page}</h2></div>
        ${page < 3 ? '<a id="next" href="#">Next</a>' : ''}
      `;
      document.getElementById('next')?.addEventListener('click', (event) => {
        event.preventDefault();
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
      delayMs: 1,
      pageTimeoutMs: 100,
    });

    expect(result.totalRecords).toBe(3);
    expect(result.stopReason).toBe('control_disabled_or_missing');
  });

  it('executes scroll step calculation', () => {
    window.scrollBy = vi.fn();
    const result = performScrollStep({ distancePx: 500 });

    expect(window.scrollBy).toHaveBeenCalledWith({ top: 500, behavior: 'smooth' });
    expect(typeof result.reachedBottom).toBe('boolean');
    expect(typeof result.currentScrollY).toBe('number');
  });
});

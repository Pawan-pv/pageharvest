import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  findNextPageButton,
  executePaginationStep,
  executeScrollStep,
  isElementDisabled,
} from '@/core/navigation/runner';

describe('Navigation, Pagination & Infinite Scroll Runner', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('detects disabled buttons and links accurately', () => {
    const disabledBtn = document.createElement('button');
    disabledBtn.disabled = true;
    expect(isElementDisabled(disabledBtn)).toBe(true);

    const ariaDisabled = document.createElement('a');
    ariaDisabled.setAttribute('aria-disabled', 'true');
    expect(isElementDisabled(ariaDisabled)).toBe(true);

    const classDisabled = document.createElement('div');
    classDisabled.className = 'btn disabled';
    expect(isElementDisabled(classDisabled)).toBe(true);

    const normalBtn = document.createElement('button');
    expect(isElementDisabled(normalBtn)).toBe(false);
  });

  it('finds next button via rel="next"', () => {
    document.body.innerHTML = `
      <div class="pagination">
        <a href="/page/1">1</a>
        <a rel="next" href="/page/2">2</a>
      </div>
    `;

    const candidate = findNextPageButton();
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

    const candidate = findNextPageButton();
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

    const candidate = findNextPageButton('#custom-load-more');
    expect(candidate).not.toBeNull();
    expect(candidate?.element.id).toBe('custom-load-more');
    expect(candidate?.href).toContain('/page/3');
  });

  it('returns failure when next button is disabled', () => {
    document.body.innerHTML = `
      <div>
        <button class="next-btn" disabled>Next Page</button>
      </div>
    `;

    const result = executePaginationStep('.next-btn');
    expect(result.success).toBe(false);
    expect(result.action).toBe('none');
    expect(result.error).toContain('disabled');
  });

  it('dispatches click on next button and reports success', () => {
    document.body.innerHTML = `
      <div>
        <button id="next-page-btn">Next</button>
      </div>
    `;

    const btn = document.getElementById('next-page-btn')!;
    const clickHandler = vi.fn();
    btn.addEventListener('click', clickHandler);

    const result = executePaginationStep('#next-page-btn');
    expect(result.success).toBe(true);
    expect(result.action).toBe('clicked');
    expect(clickHandler).toHaveBeenCalledTimes(1);
  });

  it('executes scroll step calculation', () => {
    window.scrollBy = vi.fn();
    const result = executeScrollStep(500);

    expect(window.scrollBy).toHaveBeenCalledWith({ top: 500, behavior: 'smooth' });
    expect(typeof result.reachedBottom).toBe('boolean');
    expect(typeof result.currentScrollY).toBe('number');
  });
});

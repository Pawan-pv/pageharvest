import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateCssSelector,
  generateRelativeSelector,
  isDynamicId,
  filterMeaningfulClasses,
} from '@/utils/selector';

describe('Selector Utilities', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('identifies dynamic and static IDs correctly', () => {
    expect(isDynamicId('ember1234')).toBe(true);
    expect(isDynamicId(':r1:')).toBe(true);
    expect(isDynamicId('123number')).toBe(true);
    expect(isDynamicId('abc1234567def')).toBe(true);
    expect(isDynamicId('main-content')).toBe(false);
    expect(isDynamicId('product-list')).toBe(false);
  });

  it('filters out state and framework classes', () => {
    const rawClasses = ['product-card', 'active', 'hover:bg-blue-500', 'loading', 'featured'];
    const filtered = filterMeaningfulClasses(rawClasses);
    expect(filtered).toEqual(['product-card', 'featured']);
  });

  it('generates an ID selector when ID is static and unique', () => {
    document.body.innerHTML = `
      <div id="catalog-wrapper">
        <ul id="items-list">
          <li class="item">Item 1</li>
        </ul>
      </div>
    `;
    const element = document.getElementById('items-list')!;
    expect(generateCssSelector(element)).toBe('#items-list');
  });

  it('generates a class selector when class is unique in document', () => {
    document.body.innerHTML = `
      <div class="container">
        <header class="site-header-unique">
          <h1>Title</h1>
        </header>
      </div>
    `;
    const element = document.querySelector('.site-header-unique')!;
    expect(generateCssSelector(element)).toBe('header.site-header-unique');
  });

  it('generates relative selector for child element inside container', () => {
    document.body.innerHTML = `
      <div class="product-item">
        <div class="product-header">
          <h2 class="title">Wireless Headphones</h2>
        </div>
        <div class="product-pricing">
          <span class="price">$99.99</span>
        </div>
      </div>
    `;
    const container = document.querySelector('.product-item')!;
    const title = container.querySelector('.title')!;
    const price = container.querySelector('.price')!;

    const titleSelector = generateRelativeSelector(container, title);
    const priceSelector = generateRelativeSelector(container, price);

    expect(container.querySelector(titleSelector)).toBe(title);
    expect(container.querySelector(priceSelector)).toBe(price);
  });
});

import { afterEach, describe, it, expect } from 'vitest';
import {
  buildSemanticSelector,
  buildFilteredClassSelector,
  buildStructuralPath,
  buildElementFingerprint,
  inferExpectedValueType,
  fingerprintSimilarity,
  normalizeSelectorAnchor,
  isEphemeralClass,
} from '@/core/detection/anchors';
import { safeQuery, safeQueryAll } from '@/utils/safe-dom';
import {
  MultiAnchorSelectorSchema,
  ElementFingerprintSchema,
  normalizeSelectorAnchor as normalizeViaContracts,
} from '@/shared/contracts';
import { ExtractionFieldSchema } from '@/shared/contracts/field';
import { ExtractionSchemaSchema } from '@/shared/contracts/schema';

/**
 * Fixture: a product list with every kind of hostile class name found in the
 * wild (Tailwind states, arbitrary values, hashed CSS-in-JS tokens) placed on
 * the same element as the useful semantic ones.
 */
function host(): HTMLElement {
  const container = document.createElement('ul');
  container.id = 'feed';
  container.setAttribute('role', 'feed');
  container.setAttribute('data-testid', 'product-feed');
  (container.textContent as unknown as string) = '';

  const li2 = document.createElement('li');
  li2.className =
    'card hover:bg-blue-500 focus:outline-none css-1a2b3c grid grid-cols-3 md:flex bg-[#123456]';
  li2.setAttribute('data-testid', 'item-card');
  const title2 = document.createElement('h3');
  title2.textContent = 'Second';
  li2.appendChild(title2);

  const price = document.createElement('span');
  price.className = 'price amount';
  price.textContent = '$12.50';
  li2.appendChild(price);

  const link = document.createElement('a');
  link.href = 'https://example.com/2';
  link.textContent = 'Open';
  li2.appendChild(link);

  container.appendChild(li2);
  const li1 = document.createElement('li');
  li1.className = 'card';
  const title1 = document.createElement('h3');
  title1.textContent = 'First';
  li1.appendChild(title1);
  container.appendChild(li1);

  const root = document.createElement('section');
  root.appendChild(container);
  document.body.appendChild(root);
  return container;
}

afterEach(() => {
  document.body.textContent = '';
});

describe('isEphemeralClass', () => {
  it('rejects Tailwind state, arbitrary-value and hashed classes', () => {
    expect(isEphemeralClass('hover:bg-blue-500')).toBe(true);
    expect(isEphemeralClass('focus:outline-none')).toBe(true);
    expect(isEphemeralClass('bg-[#123456]')).toBe(true);
    expect(isEphemeralClass('md:flex')).toBe(true);
    expect(isEphemeralClass('css-1a2b3c')).toBe(true);
  });

  it('keeps meaningful tokens', () => {
    expect(isEphemeralClass('card')).toBe(false);
    expect(isEphemeralClass('price')).toBe(false);
    expect(isEphemeralClass('product-card')).toBe(false);
  });
});

describe('tier builders', () => {
  it('prefers data-testid for the Tier-1 semantic selector', () => {
    const container = host();
    expect(buildSemanticSelector(container)).toBe('[data-testid="product-feed"]');
  });

  it('falls back to role and aria-label when no test id exists', () => {
    const el = document.createElement('div');
    el.setAttribute('role', 'feed');
    el.setAttribute('aria-label', 'Results');
    expect(buildSemanticSelector(el)).toBe('[role="feed"]');
  });

  it('returns null when nothing semantic exists', () => {
    const el = document.createElement('div');
    expect(buildSemanticSelector(el)).toBeNull();
  });

  it('builds a Tier-2 filtered class selector without ephemeral tokens', () => {
    const container = host();
    const li = container.querySelector('li') as HTMLElement;
    const selector = buildFilteredClassSelector(li);
    expect(selector).toBe('li.card');
    expect(selector).not.toContain('hover');
    // The filtered selector must be executable without throwing.
    expect(() => container.querySelectorAll(selector ?? '')).not.toThrow();
    expect(container.querySelectorAll(selector ?? '').length).toBe(2);
  });

  it('returns null when the element has no meaningful classes', () => {
    const el = document.createElement('span');
    expect(buildFilteredClassSelector(el)).toBeNull();
  });

  it('builds a Tier-3 relative structural path with nth-of-type', () => {
    const container = host();
    const secondLi = container.querySelectorAll('li')[1];
    const path = buildStructuralPath(secondLi, container);
    expect(path).toBe('li:nth-of-type(2)');
  });

  it('builds a deeper Tier-3 path through intermediate wrappers', () => {
    const container = document.createElement('article');
    const wrapper = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = 'Title';
    wrapper.appendChild(title);
    container.appendChild(wrapper);
    const path = buildStructuralPath(title, container);
    expect(path).toBe('div:nth-of-type(1) > h3:nth-of-type(1)');
  });
});

describe('buildElementFingerprint', () => {
  it('captures tag, depth, sibling index, value type and class tokens', () => {
    const container = host();
    const secondLi = container.querySelectorAll('li')[1];
    const fp = buildElementFingerprint(secondLi, container);
    expect(fp.tagName).toBe('li');
    expect(fp.relativeDepth).toBe(1);
    expect(fp.siblingIndex).toBe(2); // 1-based nth-of-type position
    expect(fp.expectedValueType).toBe('text');
    expect(fp.commonClassTokens).toEqual(['card']);
  });

  it('infers value types for links, images and prices', () => {
    const anchor = document.createElement('a');
    anchor.setAttribute('href', 'https://example.com');
    expect(inferExpectedValueType(anchor)).toBe('url');

    const img = document.createElement('img');
    img.setAttribute('src', '/ok.jpg');
    expect(inferExpectedValueType(img)).toBe('image');

    const price = document.createElement('span');
    price.textContent = '$12.50';
    expect(inferExpectedValueType(price)).toBe('price');

    const count = document.createElement('span');
    count.textContent = '12 reviews';
    expect(inferExpectedValueType(count)).toBe('number');

    const plain = document.createElement('h3');
    plain.textContent = 'Nice widget';
    expect(inferExpectedValueType(plain)).toBe('text');
  });
});

describe('fingerprintSimilarity', () => {
  const base = ElementFingerprintSchema.parse({
    tagName: 'li',
    relativeDepth: 1,
    siblingIndex: 2,
    expectedValueType: 'text',
    commonClassTokens: ['card', 'price'],
  });

  it('gives identical fingerprints a perfect score', () => {
    expect(fingerprintSimilarity(base, { ...base })).toBe(1);
  });

  it('punishes a different tag name', () => {
    expect(fingerprintSimilarity(base, { ...base, tagName: 'div' })).toBeLessThan(0.5);
  });

  it('scores a shifted but similar element moderately', () => {
    expect(fingerprintSimilarity(base, { ...base, siblingIndex: 3 })).toBeGreaterThan(0.7);
    expect(fingerprintSimilarity(base, { ...base, commonClassTokens: [] })).toBeLessThan(1);
  });
});

describe('safeQuery', () => {
  it('returns empty results for an invalid selector instead of throwing', () => {
    expect(() => safeQueryAll(document, '[data-x=')).not.toThrow();
    expect(safeQueryAll(document, '[data-x=')).toEqual([]);
    expect(safeQuery(document, '[data-x=')).toBeNull();
  });

  it('still finds elements for valid selectors', () => {
    expect(safeQuery(host(), 'li[data-testid="item-card"]')).not.toBeNull();
  });
});

describe('selector contracts', () => {
  it('normalizes a legacy string selector into a multi-anchor object', () => {
    const anchor = normalizeSelectorAnchor('ul#feed > li.card');
    expect(anchor).toEqual({
      primary: 'ul#feed > li.card',
      fallbackClass: undefined,
      structuralPath: undefined,
      fingerprint: undefined,
    });
    expect(MultiAnchorSelectorSchema.parse(anchor)).toEqual(anchor);
    const viaContracts = normalizeViaContracts('ul#feed > li.card');
    expect(viaContracts).toEqual(anchor);
  });

  it('normalizes a persisted anchor object, refilling missing tiers', () => {
    const anchor = normalizeSelectorAnchor({
      primary: '[data-testid="item"]',
      structuralPath: 'div:nth-of-type(1)',
    });
    expect(anchor?.primary).toBe('[data-testid="item"]');
    expect(anchor?.structuralPath).toBe('div:nth-of-type(1)');
    expect(anchor?.fallbackClass).toBeUndefined();
  });

  it('returns null for unusable input', () => {
    expect(normalizeSelectorAnchor('')).toBeNull();
    expect(normalizeSelectorAnchor(null)).toBeNull();
    expect(normalizeSelectorAnchor(42)).toBeNull();
  });

  it('keeps legacy recipes parsing without anchor fields', () => {
    const field = ExtractionFieldSchema.parse({
      id: 'f1',
      name: 'Title',
      selector: 'h3.title',
      extractor: 'text',
    });
    expect(field.anchor).toBeUndefined();
  });

  it('accepts an anchor on fields and container in the recipe schema', () => {
    const anchor = MultiAnchorSelectorSchema.parse({ primary: 'h3.title' });
    const field = ExtractionFieldSchema.parse({
      id: 'f1',
      name: 'Title',
      selector: 'h3.title',
      extractor: 'text',
      anchor,
    });
    expect(field.anchor?.primary).toBe('h3.title');

    const recipe = ExtractionSchemaSchema.parse({
      id: 's1',
      name: 'Feed',
      urlPattern: 'https://example.com/*',
      containerSelector: 'ul > li',
      containerAnchor: { primary: 'ul#feed > li' },
      fields: [{ id: 'f1', name: 'Title', selector: 'h3', extractor: 'text' }],
    });
    expect(recipe.containerAnchor?.primary).toBe('ul#feed > li');
  });
});

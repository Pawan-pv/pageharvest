import { beforeEach, describe, expect, it } from 'vitest';
import { normalizeImageUrl } from '@/core/extraction/normalizer';
import { discoverFieldsInCluster, suggestionsToFieldDefinitions } from '@/core/detection/fields';
import { extractRecordsFromContainers } from '@/core/extraction/extractor';

const BASE = 'https://shop.example/catalog/page.html';
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const image = (html: string) => {
  document.body.innerHTML = html;
  return normalizeImageUrl(document.body.firstElementChild, BASE);
};

describe('normalizeImageUrl finds the real image', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('uses a plain src', () => {
    expect(image('<img src="/a.jpg">')).toBe('https://shop.example/a.jpg');
  });

  it.each(['data-src', 'data-lazy-src', 'data-original', 'data-lazy', 'data-url'])(
    'prefers %s over a placeholder src',
    (attribute) => {
      expect(image(`<img src="${PIXEL}" ${attribute}="/real.jpg">`)).toBe('https://shop.example/real.jpg');
    }
  );

  it.each(['/img/blank.gif', '/assets/placeholder.png', '/spacer.gif', '/lazy-loader.svg', '/img/loading.gif', '/1x1.png', '/transparent.png'])(
    'treats %s as a placeholder when a real source exists',
    (placeholder) => {
      expect(image(`<img src="${placeholder}" data-src="/real.jpg">`)).toBe('https://shop.example/real.jpg');
    }
  );

  it('prefers the loaded image over its lazy attribute', () => {
    expect(image('<img src="/loaded.jpg" data-src="/other.jpg">')).toBe('https://shop.example/loaded.jpg');
  });

  it('uses the browser\'s current source when it has one', () => {
    document.body.innerHTML = `<img src="${PIXEL}" srcset="/s.jpg 300w, /l.jpg 900w">`;
    const element = document.body.firstElementChild as HTMLImageElement;
    Object.defineProperty(element, 'currentSrc', { value: 'https://cdn.example/chosen.jpg' });

    expect(normalizeImageUrl(element, BASE)).toBe('https://cdn.example/chosen.jpg');
  });

  it('ignores a current source that is itself a placeholder', () => {
    document.body.innerHTML = `<img src="${PIXEL}" data-src="/real.jpg">`;
    const element = document.body.firstElementChild as HTMLImageElement;
    Object.defineProperty(element, 'currentSrc', { value: PIXEL });

    expect(normalizeImageUrl(element, BASE)).toBe('https://shop.example/real.jpg');
  });

  it('picks the largest candidate from srcset', () => {
    expect(image(`<img src="${PIXEL}" srcset="/s.jpg 300w, /l.jpg 1200w, /m.jpg 600w">`)).toBe('https://shop.example/l.jpg');
    expect(image(`<img src="${PIXEL}" srcset="/one.jpg 1x, /two.jpg 2x">`)).toBe('https://shop.example/two.jpg');
    expect(image(`<img src="${PIXEL}" data-srcset="/s.jpg 100w, /l.jpg 800w">`)).toBe('https://shop.example/l.jpg');
  });

  it('handles commas inside srcset URLs', () => {
    expect(image(`<img src="${PIXEL}" srcset="/w_100,h_100/a.jpg 100w, /w_900,h_900/a.jpg 900w">`)).toBe('https://shop.example/w_900,h_900/a.jpg');
  });

  it('reads a responsive picture', () => {
    expect(
      image(`<picture><source srcset="/small.webp 400w, /big.webp 1600w"><img src="${PIXEL}"></picture>`)
    ).toBe('https://shop.example/big.webp');
  });

  it('reads a picture source selected directly', () => {
    document.body.innerHTML = '<picture><source srcset="/a.webp 400w, /b.webp 800w"><img></picture>';

    expect(normalizeImageUrl(document.querySelector('source'), BASE)).toBe('https://shop.example/b.webp');
  });

  it('reads a background image', () => {
    expect(image('<div style="background-image: url(\'/bg.jpg\')"></div>')).toBe('https://shop.example/bg.jpg');
  });

  it('reads an image inside a wrapper element', () => {
    expect(image('<a href="/x"><img data-src="/inner.jpg"></a>')).toBe('https://shop.example/inner.jpg');
  });

  it('resolves relative URLs against the page', () => {
    expect(image('<img src="pic.jpg">')).toBe('https://shop.example/catalog/pic.jpg');
    expect(image('<img src="../pic.jpg">')).toBe('https://shop.example/pic.jpg');
    expect(image('<img src="//cdn.example/pic.jpg">')).toBe('https://cdn.example/pic.jpg');
  });

  it('never stores a placeholder when no real image exists', () => {
    expect(image(`<img src="${PIXEL}">`)).toBeNull();
    expect(image('<img src="/img/blank.gif">')).toBeNull();
    expect(image('<img>')).toBeNull();
  });

  it('keeps a substantial embedded image, since it is the real picture', () => {
    const embedded = `data:image/png;base64,${'A'.repeat(4000)}`;

    expect(image(`<img src="${embedded}">`)).toBe(embedded);
  });
});

describe('image fields in a real extraction', () => {
  it('offers an image column for images that are only lazily loaded, and reads the real URL', () => {
    document.body.innerHTML = [0, 1, 2]
      .map((i) => `<article class="card"><h3>Book ${i}</h3><img src="${PIXEL}" data-src="/real-${i}.jpg"></article>`)
      .join('');
    const items = Array.from(document.querySelectorAll('.card'));
    const fields = suggestionsToFieldDefinitions(discoverFieldsInCluster(items));

    const { records } = extractRecordsFromContainers(items, fields, 1, undefined, BASE);

    expect(records.map((row) => row.Image)).toEqual([
      'https://shop.example/real-0.jpg',
      'https://shop.example/real-1.jpg',
      'https://shop.example/real-2.jpg',
    ]);
  });

  it('keeps the row and counts the image as missing when there is none', () => {
    document.body.innerHTML = [0, 1, 2]
      .map((i) => `<article class="card"><h3>Book ${i}</h3>${i === 1 ? '<img>' : `<img src="/r${i}.jpg">`}</article>`)
      .join('');
    const items = Array.from(document.querySelectorAll('.card'));
    const fields = suggestionsToFieldDefinitions(discoverFieldsInCluster(items));

    const { records, missingFieldCount } = extractRecordsFromContainers(items, fields, 1, undefined, BASE);

    expect(records).toHaveLength(3);
    expect(records[1].Image).toBeNull();
    expect(missingFieldCount).toBe(1);
  });
});

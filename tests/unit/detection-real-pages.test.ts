import { beforeEach, describe, expect, it } from 'vitest';
import { autoDetectLists } from '@/core/detection';
import { detectFieldsInContainer, suggestionsToFieldDefinitions } from '@/core/detection/fields';
import { extractRecordsFromContainers } from '@/core/extraction/extractor';

/**
 * Real pages surround the data with navigation. These layouts follow the structure of real
 * catalog and quote sites, where the first version of auto-detect picked the navigation:
 * it ranked lists by size and only considered containers with list-like class names.
 */
const repeat = (count: number, item: (index: number) => string): string =>
  Array.from({ length: count }, (_, index) => item(index)).join('');

const catalogPage = (): string => `
  <header class="header"><h1><a href="/">Book Shop</a></h1></header>
  <ul class="breadcrumb"><li><a href="/">Home</a></li><li class="active">All products</li></ul>
  <aside class="sidebar">
    <div class="side_categories">
      <ul class="nav nav-list">
        <li><a href="/books">Books</a>
          <ul>${repeat(50, (i) => `<li><a href="/books/category-${i}">Category ${i}</a></li>`)}</ul>
        </li>
      </ul>
    </div>
  </aside>
  <section>
    <div class="alert">1000 results</div>
    <ol class="row">
      ${repeat(
        20,
        (i) => `<li class="col-xs-6">
          <article class="product_pod">
            <div class="image_container"><a href="/book-${i}"><img src="/img/${i}.jpg" alt="Book ${i}"></a></div>
            <h3><a href="/book-${i}" title="The Complete Long Title Of Book Number ${i}">The Complete Long Title...</a></h3>
            <div class="product_price"><p class="price_color">£${10 + i}.50</p></div>
          </article>
        </li>`
      )}
    </ol>
    <ul class="pager"><li class="current">Page 1 of 50</li><li class="next"><a href="/page-2">next</a></li></ul>
  </section>`;

const quotesPage = (): string => `
  <div class="container">
    <div class="row header-box">
      <div class="col-md-8"><h1><a href="/">Quotes to Read</a></h1></div>
      <div class="col-md-4"><p><a href="/login">Login</a></p></div>
    </div>
    <div class="row">
      <div class="col-md-8">
        ${repeat(
          10,
          (i) => `<div class="quote">
            <span class="text">Quotation number ${i} says something worth keeping.</span>
            <span>by <small class="author">Author ${i}</small> <a href="/author/${i}">(about)</a></span>
            <div class="tags">Tags: <a class="tag" href="/tag/a${i}">a${i}</a><a class="tag" href="/tag/b${i}">b${i}</a></div>
          </div>`
        )}
        <nav><ul class="pager"><li class="next"><a href="/page/2">Next</a></li></ul></nav>
      </div>
      <div class="col-md-4 tags-box">
        <h2>Top Ten tags</h2>
        ${repeat(10, (i) => `<span class="tag-item"><a class="tag" href="/tag/${i}">tag${i}</a></span>`)}
      </div>
    </div>
  </div>
  <footer class="footer"><p>Quotes by readers</p><p>Made with care</p></footer>`;

describe('auto-detect on pages surrounded by navigation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('chooses the products over a larger sidebar of links', () => {
    document.body.innerHTML = catalogPage();

    const [best] = autoDetectLists(document);
    const items = Array.from(document.querySelectorAll(best.itemSelector));

    expect(items).toHaveLength(20);
    expect(items.every((item) => item.querySelector('article.product_pod'))).toBe(true);
    expect(best.itemCount).toBe(20);
  });

  it('finds repeated items whose container has no list-like class name', () => {
    document.body.innerHTML = quotesPage();

    const [best] = autoDetectLists(document);
    const items = Array.from(document.querySelectorAll(best.itemSelector));

    expect(items).toHaveLength(10);
    expect(items.every((item) => item.classList.contains('quote'))).toBe(true);
  });

  it('offers the text of items that have no heading, link text or description', () => {
    document.body.innerHTML = quotesPage();

    const [best] = autoDetectLists(document);
    const first = document.querySelector(best.itemSelector) as Element;
    const samples = detectFieldsInContainer(first).map((field) => field.sampleValue);

    expect(samples).toContain('Quotation number 0 says something worth keeping.');
    expect(samples).toContain('Author 0');
  });

  it('extracts the full title when the visible text is shortened', () => {
    document.body.innerHTML = catalogPage();

    const [best] = autoDetectLists(document);
    const first = document.querySelector(best.itemSelector) as Element;
    const fields = suggestionsToFieldDefinitions(detectFieldsInContainer(first));
    const { records } = extractRecordsFromContainers(Array.from(document.querySelectorAll(best.itemSelector)), fields);

    expect(records).toHaveLength(20);
    expect(records[3].Title).toBe('The Complete Long Title Of Book Number 3');
    expect(records[3].Price).toBe(13.5);
    expect(String(records[3].Link)).toContain('/book-3');
  });

  it('extracts full titles even when the first row happens to fit on screen', () => {
    document.body.innerHTML = `<ol class="row">${repeat(
      4,
      (i) => `<li><article>
        <h3><a href="/b/${i}" title="${i === 0 ? 'Short' : `A Very Long Title Number ${i}`}">${i === 0 ? 'Short' : 'A Very Long...'}</a></h3>
        <p class="price">£${i}.50</p>
      </article></li>`
    )}</ol>`;

    const [best] = autoDetectLists(document);
    const items = Array.from(document.querySelectorAll(best.itemSelector));
    const fields = suggestionsToFieldDefinitions(detectFieldsInContainer(items[0]));
    const { records } = extractRecordsFromContainers(items, fields);

    expect(records.map((record) => record.Title)).toEqual([
      'Short',
      'A Very Long Title Number 1',
      'A Very Long Title Number 2',
      'A Very Long Title Number 3',
    ]);
  });

  it('keeps a column whose first value is a short number', () => {
    document.body.innerHTML = `<ul class="value-list">${repeat(
      3,
      (i) => `<li class="value-row"><span class="kind">kind ${i}</span><span class="val">-${i + 5}</span></li>`
    )}</ul>`;

    const [best] = autoDetectLists(document);
    const first = document.querySelector(best.itemSelector) as Element;

    expect(detectFieldsInContainer(first).map((field) => field.sampleValue)).toEqual(['kind 0', '-5']);
  });

  it('scopes a generic selector so it does not also match the navigation', () => {
    document.body.innerHTML = `
      <nav><ul>${repeat(30, (i) => `<li><a href="/n/${i}">Section ${i}</a></li>`)}</ul></nav>
      <main id="results">
        <ul>${repeat(
          6,
          (i) => `<li><h2>Result ${i}</h2><p>A longer description of result number ${i}.</p><a href="/r/${i}">Open</a></li>`
        )}</ul>
      </main>`;

    const [best] = autoDetectLists(document);
    const items = Array.from(document.querySelectorAll(best.itemSelector));

    expect(items).toHaveLength(6);
    expect(items.every((item) => item.querySelector('h2'))).toBe(true);
  });

  it('prefers a small data table over a long footer of links', () => {
    document.body.innerHTML = `
      <table><tbody>${repeat(
        5,
        (i) => `<tr><td>Name ${i}</td><td>Value ${i}</td><td>$${i}.00</td></tr>`
      )}</tbody></table>
      <footer><ul class="links">${repeat(40, (i) => `<li><a href="/f/${i}">Footer ${i}</a></li>`)}</ul></footer>`;

    const [best] = autoDetectLists(document);

    expect(document.querySelectorAll(best.itemSelector)).toHaveLength(5);
    expect(best.itemSelector).toContain('tr');
  });

  it('still returns a plain list of links when the page has nothing else', () => {
    document.body.innerHTML = `<ul>${repeat(12, (i) => `<li><a href="/a/${i}">Article ${i}</a></li>`)}</ul>`;

    const [best] = autoDetectLists(document);

    expect(document.querySelectorAll(best.itemSelector)).toHaveLength(12);
  });

  it('keeps listing the navigation as a lower-ranked candidate', () => {
    document.body.innerHTML = catalogPage();

    const lists = autoDetectLists(document);

    expect(lists.length).toBeGreaterThan(1);
    expect(lists.some((list) => list.itemCount === 50)).toBe(true);
  });
});

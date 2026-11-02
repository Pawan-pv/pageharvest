import { beforeEach, describe, expect, it } from 'vitest';
import { detectTables, tableFields } from '@/core/extraction/table-extractor';
import { detectLinkRegions, linkFields } from '@/core/extraction/link-extractor';
import { extractRecordsFromContainers } from '@/core/extraction/extractor';
import { createContentWorkflowCoordinator } from '@/content/workflow-coordinator';

const repeat = (count: number, item: (index: number) => string): string =>
  Array.from({ length: count }, (_, index) => item(index)).join('');
const rows = (selector: string) => Array.from(document.querySelectorAll(selector));

function extractTable(html: string, index = 0) {
  document.body.innerHTML = html;
  const table = detectTables(document)[index];
  const fields = tableFields(table.containerSelector, document);
  const { records } = extractRecordsFromContainers(rows(table.containerSelector), fields);
  return {
    table,
    names: fields.map((field) => field.name),
    data: records.map((row) => fields.map((field) => row[field.name])),
    records,
  };
}

describe('Extract Tables', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('uses thead cells as column names and never counts them as records', () => {
    const { names, data, table } = extractTable(`
      <table><thead><tr><th>Name</th><th>City</th></tr></thead>
      <tbody><tr><td>Ann</td><td>Oslo</td></tr><tr><td>Bo</td><td>Rome</td></tr></tbody></table>`);

    expect(names).toEqual(['Name', 'City']);
    expect(data).toEqual([['Ann', 'Oslo'], ['Bo', 'Rome']]);
    expect(table.matchCount).toBe(2);
  });

  it('uses a first row of th cells as headers when there is no thead', () => {
    const { names, data, table } = extractTable(`
      <table><tr><th>Name</th><th>City</th></tr><tr><td>Ann</td><td>Oslo</td></tr><tr><td>Bo</td><td>Rome</td></tr></table>`);

    expect(names).toEqual(['Name', 'City']);
    expect(data).toEqual([['Ann', 'Oslo'], ['Bo', 'Rome']]);
    expect(table.matchCount).toBe(2);
  });

  it('names columns itself when a table has no headers', () => {
    const { names, data } = extractTable(`<table><tr><td>Ann</td><td>Oslo</td></tr><tr><td>Bo</td><td>Rome</td></tr></table>`);

    expect(names).toEqual(['Column 1', 'Column 2']);
    expect(data).toEqual([['Ann', 'Oslo'], ['Bo', 'Rome']]);
  });

  it('reads every tbody and skips the footer', () => {
    const { data } = extractTable(`
      <table><thead><tr><th>A</th><th>B</th></tr></thead>
      <tbody><tr><td>1</td><td>2</td></tr></tbody>
      <tbody><tr><td>3</td><td>4</td></tr></tbody>
      <tfoot><tr><td>Total</td><td>10</td></tr></tfoot></table>`);

    expect(data).toEqual([['1', '2'], ['3', '4']]);
  });

  it('does not count a heading row inside a tbody', () => {
    const { data } = extractTable(`
      <table><thead><tr><th>A</th><th>B</th></tr></thead>
      <tbody><tr><th colspan="2">Section one</th></tr><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></tbody></table>`);

    expect(data).toEqual([['1', '2'], ['3', '4']]);
  });

  it('keeps a row with empty cells, and counts them as missing', () => {
    const { data, records } = extractTable(`
      <table><thead><tr><th>A</th><th>B</th></tr></thead>
      <tbody><tr><td>1</td><td></td></tr><tr><td></td><td>4</td></tr></tbody></table>`);

    expect(data).toEqual([['1', null], [null, '4']]);
    expect(records[0]._missingFields).toBe('B');
  });

  it('carries a rowspan value down, so later cells stay in their columns', () => {
    const { data } = extractTable(`
      <table><thead><tr><th>Group</th><th>Item</th><th>Qty</th></tr></thead>
      <tbody>
        <tr><td rowspan="2">G1</td><td>a</td><td>1</td></tr>
        <tr><td>b</td><td>2</td></tr>
        <tr><td>G2</td><td>c</td><td>3</td></tr>
      </tbody></table>`);

    expect(data).toEqual([['G1', 'a', '1'], ['G1', 'b', '2'], ['G2', 'c', '3']]);
  });

  it('keeps later cells in their columns after a colspan', () => {
    const { data } = extractTable(`
      <table><thead><tr><th>A</th><th>B</th><th>C</th></tr></thead>
      <tbody><tr><td colspan="2">wide</td><td>x</td></tr><tr><td>1</td><td>2</td><td>3</td></tr></tbody></table>`);

    expect(data).toEqual([['wide', null, 'x'], ['1', '2', '3']]);
  });

  it('aligns headers that use colspan', () => {
    const { names } = extractTable(`
      <table><thead><tr><th>Name</th><th colspan="2">Score</th></tr></thead>
      <tbody><tr><td>a</td><td>1</td><td>2</td></tr><tr><td>b</td><td>3</td><td>4</td></tr></tbody></table>`);

    expect(names).toEqual(['Name', 'Score', 'Score 2']);
  });

  it('makes repeated and empty header names usable', () => {
    const { names } = extractTable(`
      <table><thead><tr><th>Name</th><th>Name</th><th></th></tr></thead>
      <tbody><tr><td>a</td><td>b</td><td>c</td></tr><tr><td>d</td><td>e</td><td>f</td></tr></tbody></table>`);

    expect(names).toEqual(['Name', 'Name 2', 'Column 3']);
  });

  it('does not read a nested table as rows of the outer one', () => {
    const { data } = extractTable(`
      <table id="outer"><thead><tr><th>A</th><th>B</th></tr></thead><tbody>
        <tr><td>1</td><td><table id="inner"><tr><td>x</td></tr></table></td></tr>
        <tr><td>2</td><td>y</td></tr>
      </tbody></table>`);

    expect(data.map((row) => row[0])).toEqual(['1', '2']);
  });

  it('lists every data table, largest first, and skips layout tables', () => {
    document.body.innerHTML = `
      <table id="layout"><tr><td>One cell only</td></tr></table>
      <table id="small"><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></table>
      <table id="big"><tr><th>A</th><th>B</th><th>C</th></tr>${repeat(9, (i) => `<tr><td>${i}</td><td>x</td><td>y</td></tr>`)}</table>`;

    const tables = detectTables(document);

    expect(tables.map((table) => table.matchCount)).toEqual([9, 2]);
    expect(tables[0].suggestedFields).toEqual(['A', 'B', 'C']);
    expect(tables[0].kind).toBe('table');
    expect(tables[0].sampleSnippets.length).toBeGreaterThan(0);
  });

  it('finds nothing on a page without tables', () => {
    document.body.innerHTML = '<p>No tables here.</p>';

    expect(detectTables(document)).toEqual([]);
  });
});

describe('Extract Links', () => {
  const PAGE = `
    <header><nav><ul>${repeat(8, (i) => `<li><a href="/m/${i}">Menu ${i}</a></li>`)}</ul></nav></header>
    <main>
      <h1>Results</h1>
      <div class="results">${repeat(10, (i) => `<article><a href="/p/${i}"><img src="/p${i}.jpg" alt="Product ${i}"></a><h3><a href="/p/${i}" title="Full name ${i}">Product ${i}</a></h3></article>`)}</div>
      <nav class="in-page"><a href="/page/2">Next page</a></nav>
      <a href="#top">Back to top</a>
      <a href="javascript:void(0)">Do something</a>
    </main>
    <footer>${repeat(12, (i) => `<a href="/f/${i}">Footer ${i}</a>`)}</footer>`;

  beforeEach(() => {
    document.body.innerHTML = PAGE;
  });

  it('starts from the main content, not the site menu', () => {
    const [best] = detectLinkRegions(document);
    const links = rows(best.containerSelector);

    expect(best.kind).toBe('links');
    expect(best.credible).toBe(true);
    expect(links.every((link) => link.closest('main'))).toBe(true);
    expect(links.every((link) => !link.closest('nav'))).toBe(true);
    expect(best.matchCount).toBe(links.length);
  });

  it('leaves out links that go nowhere', () => {
    const [best] = detectLinkRegions(document);
    const hrefs = rows(best.containerSelector).map((link) => link.getAttribute('href'));

    expect(hrefs).not.toContain('#top');
    expect(hrefs).not.toContain('javascript:void(0)');
  });

  it('offers navigation and footer links as lower-ranked, not credible regions', () => {
    const regions = detectLinkRegions(document);
    const footer = regions.find((region) => rows(region.containerSelector).every((link) => link.closest('footer')));

    expect(footer).toBeDefined();
    expect(footer?.credible).toBe(false);
    expect(regions.indexOf(footer!)).toBeGreaterThan(0);
  });

  it('extracts text, absolute URL and title attribute', () => {
    const [best] = detectLinkRegions(document);
    const fields = linkFields(best.containerSelector, document);
    const { records } = extractRecordsFromContainers(rows(best.containerSelector), fields, 1, undefined, 'https://shop.example/list/');

    const titled = records.find((row) => row.Title === 'Full name 3');
    expect(titled).toMatchObject({ Text: 'Product 3', URL: 'https://shop.example/p/3' });
  });

  it('uses an image\'s alt text for a link with no text', () => {
    const [best] = detectLinkRegions(document);
    const fields = linkFields(best.containerSelector, document);
    const { records } = extractRecordsFromContainers(rows(best.containerSelector), fields, 1, undefined, 'https://shop.example/');

    expect(records[0]).toMatchObject({ Text: 'Product 0', URL: 'https://shop.example/p/0' });
  });

  it('asks a run to treat the same URL as one link', () => {
    const [best] = detectLinkRegions(document);

    expect(best.dedupeFields).toEqual(['URL']);
  });

  it('works when a page has no main landmark', () => {
    document.body.innerHTML = `
      <nav>${repeat(5, (i) => `<a href="/m/${i}">Menu ${i}</a>`)}</nav>
      <div id="content"><div class="list">${repeat(7, (i) => `<p><a href="/a/${i}">Article ${i}</a></p>`)}</div></div>`;

    const [best] = detectLinkRegions(document);

    expect(best.matchCount).toBe(7);
    expect(rows(best.containerSelector).every((link) => !link.closest('nav'))).toBe(true);
  });

  it('finds nothing on a page without links', () => {
    document.body.innerHTML = '<p>Text only.</p>';

    expect(detectLinkRegions(document)).toEqual([]);
  });
});

describe('the content script serves both tools', () => {
  const coordinator = () => createContentWorkflowCoordinator(() => undefined, document);

  it('offers tables and returns header columns', async () => {
    document.body.innerHTML = `<table><thead><tr><th>Name</th><th>City</th></tr></thead><tbody>
      <tr><td>Ann</td><td>Oslo</td></tr><tr><td>Bo</td><td>Rome</td></tr></tbody></table>`;

    const detected = await coordinator().detectRepeatedElements({
      id: 'm', timestamp: 1, type: 'DETECT_REPEATED_ELEMENTS', payload: { mode: 'table' },
    });
    expect(detected.payload.matchCount).toBe(2);

    const fields = await coordinator().detectFields({
      id: 'm', timestamp: 1, type: 'DETECT_FIELDS',
      payload: { containerSelector: detected.payload.containerSelector, kind: 'table' },
    });
    expect(fields.payload.suggestedFields.map((field) => field.name)).toEqual(['Name', 'City']);
  });

  it('explains when a page has no table', async () => {
    document.body.innerHTML = '<p>Nothing here.</p>';

    await expect(
      coordinator().detectRepeatedElements({ id: 'm', timestamp: 1, type: 'DETECT_REPEATED_ELEMENTS', payload: { mode: 'table' } })
    ).rejects.toThrow(/No data table/);
  });

  it('offers link regions and returns link columns', async () => {
    document.body.innerHTML = `<main>${repeat(4, (i) => `<a href="/a/${i}">Article ${i}</a>`)}</main>`;

    const detected = await coordinator().detectRepeatedElements({
      id: 'm', timestamp: 1, type: 'DETECT_REPEATED_ELEMENTS', payload: { mode: 'links' },
    });
    expect(detected.payload.matchCount).toBe(4);
    expect(detected.payload.candidates?.[0].dedupeFields).toEqual(['URL']);

    const fields = await coordinator().detectFields({
      id: 'm', timestamp: 1, type: 'DETECT_FIELDS',
      payload: { containerSelector: detected.payload.containerSelector, kind: 'links' },
    });
    expect(fields.payload.suggestedFields.map((field) => field.name)).toEqual(expect.arrayContaining(['Text', 'URL']));
  });
});

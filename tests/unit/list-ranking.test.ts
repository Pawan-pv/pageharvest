import { beforeEach, describe, expect, it } from 'vitest';
import { autoDetectLists } from '@/core/detection';
import { createContentWorkflowCoordinator } from '@/content/workflow-coordinator';

const repeat = (count: number, item: (index: number) => string): string =>
  Array.from({ length: count }, (_, index) => item(index)).join('');
const card = (cls: string, name: string, i: number) =>
  `<div class="${cls}"><h3>${name} ${i}</h3><img src="/${name}${i}.png"><span>$${i}.50</span><a href="/${name}/${i}">View</a></div>`;
const menu = (count: number) => `<nav><ul>${repeat(count, (i) => `<li><a href="/m/${i}">Menu ${i}</a></li>`)}</ul></nav>`;
const footer = (count: number) => `<footer><ul>${repeat(count, (i) => `<li><a href="/f/${i}">Footer ${i}</a></li>`)}</ul></footer>`;

const COMPLEX_PAGE = `
  <header>${menu(12)}</header>
  <main>
    <div class="results-area">${repeat(10, (i) => card('result', 'Real', i))}</div>
    <section class="recommended-products"><h2>You may also like</h2><div class="row">${repeat(24, (i) => card('tile', 'Rec', i))}</div></section>
    <section class="related-articles"><h2>Related</h2><div class="row">${repeat(6, (i) => `<div class="teaser"><h4>Article ${i}</h4><p>Teaser text for article ${i}.</p></div>`)}</div></section>
  </main>
  <aside class="sidebar"><ul>${repeat(15, (i) => `<li><a href="/c/${i}">Category ${i}</a></li>`)}</ul></aside>
  ${footer(30)}`;

describe('auto-detect ranks lists on evidence', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('ranks main results above a larger recommendations block', () => {
    document.body.innerHTML = COMPLEX_PAGE;

    const [best] = autoDetectLists(document);

    expect(document.querySelectorAll(best.itemSelector)[0].textContent).toContain('Real 0');
  });

  it('ranks results above an unlabeled-by-class carousel by what the block says about itself', () => {
    document.body.innerHTML = `
      <div class="carousel">${repeat(25, (i) => card('tile', 'Rec', i))}</div>
      <main>${repeat(10, (i) => card('result', 'Real', i))}</main>`;

    expect(autoDetectLists(document)[0].itemCount).toBe(10);
  });

  it('offers the other lists as alternatives, up to eight', () => {
    document.body.innerHTML = COMPLEX_PAGE;

    const lists = autoDetectLists(document);
    const counts = lists.map((list) => list.itemCount);

    expect(lists.length).toBeLessThanOrEqual(8);
    expect(counts).toEqual(expect.arrayContaining([10, 24, 6]));
  });

  it('scores navigation, sidebars and footers as not credible', () => {
    document.body.innerHTML = COMPLEX_PAGE;

    const lists = autoDetectLists(document);
    const navigationLists = lists.filter((list) =>
      /Menu|Category|Footer/.test(list.sampleElements[0]?.previewText ?? '')
    );

    expect(navigationLists.length).toBeGreaterThan(0);
    for (const list of navigationLists) {
      expect(list.credible).toBe(false);
    }
    expect(lists[0].credible).toBe(true);
  });

  it('does not give a blog menu high confidence', () => {
    document.body.innerHTML = `${menu(6)}<article><h1>A post</h1>${repeat(6, (i) => `<p>Paragraph ${i} of prose.</p>`)}</article>${footer(5)}`;

    const lists = autoDetectLists(document);

    expect(lists.every((list) => list.credible === false)).toBe(true);
    expect(Math.max(...lists.map((list) => list.confidence))).toBeLessThan(0.3);
  });

  it('explains the score with the evidence behind it', () => {
    document.body.innerHTML = COMPLEX_PAGE;

    const lists = autoDetectLists(document);
    const results = lists[0];
    const recommended = lists.find((list) => list.itemCount === 24);
    const navigation = lists.find((list) => /Menu/.test(list.sampleElements[0]?.previewText ?? ''));

    expect(results.evidence).toEqual(expect.arrayContaining(['in the main content']));
    expect(recommended?.evidence).toEqual(expect.arrayContaining(['labelled as recommendations or promotions']));
    expect(navigation?.evidence).toEqual(expect.arrayContaining(['inside navigation, a sidebar or a footer']));
  });

  it('is not tuned to these fixtures: a different vocabulary still works', () => {
    document.body.innerHTML = `
      <div role="navigation"><div>${repeat(20, (i) => `<div><a href="/x/${i}">Link ${i}</a></div>`)}</div></div>
      <div role="main"><div>${repeat(8, (i) => `<div><h2>Listing ${i}</h2><p>Details of listing ${i} here.</p><b>€${i},50</b></div>`)}</div></div>`;

    const [best] = autoDetectLists(document);

    expect(best.itemCount).toBe(8);
    expect(best.credible).toBe(true);
  });

  it('returns no candidates on a page with no repetition', () => {
    document.body.innerHTML = '<h1>Hello</h1><p>One paragraph.</p>';

    expect(autoDetectLists(document)).toEqual([]);
  });
});

describe('the content script offers candidates instead of choosing silently', () => {
  const coordinatorFor = (html: string) => {
    document.body.innerHTML = html;
    return createContentWorkflowCoordinator(() => undefined, document);
  };
  const detect = (html: string) =>
    coordinatorFor(html).detectRepeatedElements({ id: 'm', timestamp: 1, type: 'DETECT_REPEATED_ELEMENTS' });

  it('sends ranked candidates with what the user needs to choose', async () => {
    const reply = await detect(COMPLEX_PAGE);
    const { candidates, credible, containerSelector } = reply.payload;

    expect(credible).toBe(true);
    expect(candidates?.length).toBeGreaterThan(1);
    expect(candidates?.length).toBeLessThanOrEqual(8);
    expect(candidates?.[0]).toMatchObject({ containerSelector, kind: 'list', credible: true });
    for (const candidate of candidates ?? []) {
      expect(candidate.matchCount).toBe(document.querySelectorAll(candidate.containerSelector).length);
      expect(candidate.sampleSnippets.length).toBeGreaterThan(0);
      expect(candidate.confidence).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(candidate.suggestedFields)).toBe(true);
      expect(candidate.evidence.length).toBeGreaterThan(0);
    }
  });

  it('says so when nothing on the page is credible', async () => {
    const reply = await detect(`${menu(6)}<article><h1>Post</h1><p>Only one paragraph here.</p></article>`);

    expect(reply.payload.credible).toBe(false);
  });

  it('still reports an error when there is nothing to offer', async () => {
    await expect(detect('<h1>Hello</h1>')).rejects.toThrow(/No repeated list/);
  });
});

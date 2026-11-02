import { beforeEach, describe, expect, it } from 'vitest';
import { detectListFromSelection } from '@/core/detection';

const repeat = (count: number, item: (index: number) => string): string =>
  Array.from({ length: count }, (_, index) => item(index)).join('');
const menu = (count = 30) =>
  `<nav><ul>${repeat(count, (i) => `<li><a href="/n/${i}">Menu ${i}</a></li>`)}</ul></nav>`;
const result = (i: number) => `<li><h2>Result ${i}</h2><p>Long description of result ${i}.</p></li>`;

/** What the panel shows must be exactly what extraction will read. */
function expectSameScope(target: Element | null) {
  const picked = detectListFromSelection(target as Element);
  expect(picked).not.toBeNull();
  const extracted = Array.from(document.querySelectorAll(picked!.itemSelector));
  expect(picked!.itemCount).toBe(extracted.length);
  expect(picked!.matchedElements).toEqual(extracted);
  expect(picked!.containerSelector).toBe(picked!.itemSelector);
  return { picked: picked!, extracted };
}

describe('the picker selects one list, with one scope', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('does not take in a classless menu when a row is picked', () => {
    document.body.innerHTML = `${menu()}<main><ul>${repeat(6, result)}</ul></main>`;

    const { extracted } = expectSameScope(document.querySelector('main li'));

    expect(extracted).toHaveLength(6);
    expect(extracted.every((item) => item.closest('main'))).toBe(true);
  });

  it('does not take in a classless menu when something inside a row is picked', () => {
    document.body.innerHTML = `${menu()}<main><ul>${repeat(6, result)}</ul></main>`;

    expect(expectSameScope(document.querySelector('main li h2')).extracted).toHaveLength(6);
  });

  it('does not take in the menu for a short list', () => {
    document.body.innerHTML = `${menu()}<main><ul>${repeat(3, result)}</ul></main>`;

    expect(expectSameScope(document.querySelector('main li')).extracted).toHaveLength(3);
  });

  it('keeps two lists apart when they have the same shape and no classes at all', () => {
    document.body.innerHTML = `<div><ul>${repeat(4, result)}</ul></div><div><ul>${repeat(5, (i) => result(i + 10))}</ul></div>`;

    const { extracted } = expectSameScope(document.querySelectorAll('ul')[1].querySelector('li'));

    expect(extracted).toHaveLength(5);
    expect(extracted[0].textContent).toContain('Result 10');
  });

  it('does not mix in recommendations that use the same card class', () => {
    const card = (name: string, i: number) => `<div class="card"><h3>${name} ${i}</h3><span class="price">$${i}.00</span></div>`;
    document.body.innerHTML = `
      <main><section class="grid">${repeat(4, (i) => card('Real', i))}</section></main>
      <section class="grid">${repeat(9, (i) => card('Recommended', i))}</section>`;

    const { extracted } = expectSameScope(document.querySelector('main .card'));

    expect(extracted).toHaveLength(4);
    expect(extracted.every((item) => item.textContent?.includes('Real'))).toBe(true);
  });

  it('still treats the rows of one grid as one list', () => {
    const row = (start: number) =>
      `<div class="row">${repeat(3, (i) => `<div class="card"><h3>Item ${start + i}</h3><p>Some description ${start + i}.</p></div>`)}</div>`;
    document.body.innerHTML = `<section>${row(0)}${row(3)}${row(6)}</section>`;

    expect(expectSameScope(document.querySelector('.card')).extracted).toHaveLength(9);
  });

  it('selects only the outer rows of a nested list', () => {
    document.body.innerHTML = `<ul id="outer">${repeat(
      4,
      (i) => `<li><h2>Group ${i}</h2><ul>${repeat(2, (j) => `<li><span>Inner ${i}.${j}</span></li>`)}</ul></li>`
    )}</ul>`;

    const { extracted } = expectSameScope(document.querySelector('#outer > li'));

    expect(extracted).toHaveLength(4);
    expect(extracted.every((item) => item.parentElement?.id === 'outer')).toBe(true);
  });

  it('selects only the inner rows when an inner row is picked', () => {
    document.body.innerHTML = `<ul>${repeat(
      4,
      (i) => `<li class="group"><h2>Group ${i}</h2><ul class="tags">${repeat(3, (j) => `<li class="tag">Inner ${i}.${j} text</li>`)}</ul></li>`
    )}</ul>`;

    const target = document.querySelectorAll('.tags')[2].querySelector('.tag');
    const { extracted } = expectSameScope(target);

    expect(extracted.every((item) => item.classList.contains('tag'))).toBe(true);
  });

  it('keeps nested content inside each selected row', () => {
    document.body.innerHTML = `${menu(4)}<main><ul>${repeat(
      3,
      (i) => `<li><h2>Row ${i}</h2><ul><li>Detail A${i}</li><li>Detail B${i}</li></ul></li>`
    )}</ul></main>`;

    const { extracted } = expectSameScope(document.querySelector('main > ul > li'));

    expect(extracted).toHaveLength(3);
    expect(extracted[0].querySelectorAll('li')).toHaveLength(2);
  });
});

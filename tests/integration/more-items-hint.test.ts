import { afterEach, describe, expect, it, vi } from 'vitest';
import { createContentWorkflowCoordinator } from '@/content/workflow-coordinator';
import { registerJobHandlers } from '@/background/register-job-handlers';
import { MessageRouter } from '@/platform/message-router';
import { ExtensionMessage } from '@/contracts/messages';
import type { JobCoordinator } from '@/background/job-coordinator';

const CARDS = `
  <main>
    <ul class="products">
      <li class="product"><h3><a href="/a">A Light in the Attic</a></h3><p class="price">$51.77</p></li>
      <li class="product"><h3><a href="/b">Tipping the Velvet</a></h3><p class="price">$53.74</p></li>
      <li class="product"><h3><a href="/c">Soumission</a></h3><p class="price">$50.10</p></li>
      <li class="product"><h3><a href="/d">Sharp Objects</a></h3><p class="price">$47.82</p></li>
    </ul>
  </main>`;

const TABLE = `
  <table><thead><tr><th>Name</th><th>Price</th></tr></thead><tbody>
    <tr><td>Keyboard</td><td>$49</td></tr><tr><td>Mouse</td><td>$29</td></tr><tr><td>Monitor</td><td>$199</td></tr>
  </tbody></table>`;

const NEXT_LINK = '<ul class="pager"><li class="next"><a href="/page-2.html">next</a></li></ul>';

async function detect(html: string, payload: { targetSelector?: string; mode?: 'table' | 'links' } = {}) {
  document.body.innerHTML = html;
  const emitted: ExtensionMessage[] = [];
  const coordinator = createContentWorkflowCoordinator((message) => emitted.push(message));
  const response = await coordinator.detectRepeatedElements({
    id: 'detect_1',
    type: 'DETECT_REPEATED_ELEMENTS',
    timestamp: 1,
    payload,
  });
  return { response, emitted };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Detection reports whether the list continues (ADR-039)', () => {
  it('says "next" when the page has a Next link', async () => {
    const { response, emitted } = await detect(`${CARDS}${NEXT_LINK}`);
    expect(response.payload.moreItems).toBe('next');
    // The panel gets the same message the caller does.
    expect(emitted[0]).toEqual(response);
  });

  it('says "load_more" when the page has a Load more button', async () => {
    const { response } = await detect(`${CARDS}<button type="button" class="load">Load more</button>`);
    expect(response.payload.moreItems).toBe('load_more');
  });

  it('says "none" when the page has neither', async () => {
    const { response } = await detect(CARDS);
    expect(response.payload.moreItems).toBe('none');
  });

  it('says "none" when the only Next control is disabled', async () => {
    const { response } = await detect(`${CARDS}<button type="button" disabled>Next</button>`);
    expect(response.payload.moreItems).toBe('none');
  });

  it('reports it for a picked item and for the Table preset as well', async () => {
    const pager = '<a class="next" rel="next" href="/page/2">Next</a>';
    const picked = await detect(`${CARDS}${pager}`, { targetSelector: '.product' });
    expect(picked.response.payload.moreItems).toBe('next');
    const table = await detect(`${TABLE}${pager}`, { mode: 'table' });
    expect(table.response.payload.moreItems).toBe('next');
  });

  it('only looks: it never clicks, scrolls, focuses or leaves the page', async () => {
    const html = `${CARDS}${NEXT_LINK}<button type="button">Load more</button>`;
    document.body.innerHTML = html;
    const before = document.body.innerHTML;
    const hrefBefore = window.location.href;

    const click = vi.spyOn(HTMLElement.prototype, 'click');
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    const dispatch = vi.spyOn(EventTarget.prototype, 'dispatchEvent');
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    const emitted: ExtensionMessage[] = [];
    const coordinator = createContentWorkflowCoordinator((message) => emitted.push(message));
    const response = await coordinator.detectRepeatedElements({
      id: 'detect_1',
      type: 'DETECT_REPEATED_ELEMENTS',
      timestamp: 1,
      payload: {},
    });

    expect(response.payload.moreItems).toBe('next');
    expect(click).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(scrollBy).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(window.location.href).toBe(hrefBefore);
    expect(document.body.innerHTML).toBe(before);
  });

  it('still reports the list when looking for the control throws', async () => {
    document.body.innerHTML = CARDS;
    // A page can make any DOM read throw; the hint must never cost the user their list.
    const emitted: ExtensionMessage[] = [];
    const coordinator = createContentWorkflowCoordinator((message) => emitted.push(message), document, {
      findMoreItems: () => {
        throw new Error('unexpected page structure');
      },
    });
    const response = await coordinator.detectRepeatedElements({
      id: 'detect_1',
      type: 'DETECT_REPEATED_ELEMENTS',
      timestamp: 1,
      payload: {},
    });
    expect(response.payload.matchCount).toBe(4);
    expect(response.payload).not.toHaveProperty('moreItems');
  });
});

describe('The background ignores the hint', () => {
  it('registers no handler for REPEATED_ELEMENTS_DETECTED, so it cannot reach a job or storage', () => {
    const router = new MessageRouter();
    const on = vi.spyOn(router, 'on');
    registerJobHandlers(router, {} as JobCoordinator);
    const handled = on.mock.calls.map(([type]) => type);
    expect(handled.length).toBeGreaterThan(0);
    expect(handled).not.toContain('REPEATED_ELEMENTS_DETECTED');
  });
});

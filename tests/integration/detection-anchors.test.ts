import { describe, it, expect, afterEach } from 'vitest';
import { autoDetectLists, detectListFromSelection } from '@/core/detection';
import { discoverFieldsInCluster, suggestionsToFieldDefinitions } from '@/core/detection/fields';
import { attachFieldAnchors } from '@/core/detection/anchors';
import { ListCandidateSchema } from '@/shared/contracts/message';
import { ExtractionFieldSchema } from '@/shared/contracts/field';
import type { DiscoveredField } from '@/types/detection';

/**
 * Fixture: second-generation markup with ephemeral classes and semantic
 * attributes, the way a real catalog looks after a redesign or an A/B variant.
 */
function catalog(): HTMLElement {
  document.body.innerHTML = `
    <main>
      <ul id="feed" data-testid="product-feed" role="list">
        <li class="product-card price hover:bg-slate-100 css-b7xk21 md:flex" data-testid="item">
          <h3 class="title">Alpha Widget</h3>
          <img class="thumb" src="/alpha.jpg" alt="alpha">
          <span class="price amount">$19.90</span>
          <a class="view-link" href="https://shop.test/alpha">View</a>
        </li>
        <li class="product-card price hover:bg-slate-100 css-b7xk21" data-testid="item">
          <h3 class="title">Beta Widget</h3>
          <img class="thumb" src="/beta.jpg" alt="beta">
          <span class="price amount">$24.50</span>
          <a class="view-link" href="https://shop.test/beta">View</a>
        </li>
        <li class="product-card price hover:bg-slate-100 css-b7xk21" data-testid="item">
          <h3 class="title">Gamma Widget</h3>
          <img class="thumb" src="/gamma.jpg" alt="gamma">
          <span class="price amount">$31.00</span>
          <a class="view-link" href="https://shop.test/gamma">View</a>
        </li>
      </ul>
    </main>`;
  return document.body;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('detection container anchors', () => {
  it('attached to the list chosen via element selection', () => {
    catalog();
    const item = document.querySelectorAll('li')[0];
    const list = detectListFromSelection(item as HTMLElement);
    expect(list).not.toBeNull();
    expect(list?.containerAnchor).toBeDefined();
    expect(list?.containerAnchor?.primary).toBe(list?.containerSelector);
    expect(list?.containerAnchor?.fallbackClass).toContain('li.product-card');
    expect(list?.containerAnchor?.structuralPath).toMatch(/^li:nth-of-type\(\d\)$/);
    expect(list?.containerAnchor?.fingerprint?.tagName).toBe('li');
  });

  it('attached to auto-detected lists with Tier-2 utility tokens stripped', () => {
    catalog();
    const lists = autoDetectLists(document);
    expect(lists.length).toBeGreaterThan(0);
    const product = lists.find((candidate) => candidate.containerAnchor?.fallbackClass?.includes('product-card'));
    expect(product).toBeDefined();
    const tier2 = product?.containerAnchor?.fallbackClass ?? '';
    expect(tier2).not.toContain('hover');
    expect(tier2).not.toContain('css-');
    expect(tier2).not.toContain(':');
  });

  it('anchors survive the message contract when carried in a candidate', () => {
    catalog();
    const list = autoDetectLists(document)[0];
    const candidate = ListCandidateSchema.parse({
      containerSelector: list.containerSelector,
      containerAnchor: list.containerAnchor,
      matchCount: list.itemCount,
      sampleSnippets: [],
      name: list.name,
      kind: 'list',
      credible: true,
      confidence: list.confidence,
      evidence: [],
      suggestedFields: [],
    });
    expect(candidate.containerAnchor?.fingerprint?.tagName).toBe('li');
  });
});

describe('detection field anchors', () => {
  /** The production DETECT_FIELDS path: discovery once, anchors on the result only. */
  function fieldsWithAnchors(): DiscoveredField[] {
    const items = Array.from(document.querySelectorAll('li')) as HTMLElement[];
    return attachFieldAnchors(discoverFieldsInCluster(items), items[0]);
  }

  it('captures a fingerprint for the discovered Title field', () => {
    catalog();
    const title = fieldsWithAnchors().find((field) => field.name === 'Title');
    expect(title?.anchor?.fingerprint?.tagName).toBe('h3');
    expect(title?.anchor?.structuralPath).toMatch(/^h3/);
    expect(title?.anchor?.fingerprint?.expectedValueType).toBe('text');
  });

  it('typed fingerprints for link, image and price fields', () => {
    catalog();
    const fields = fieldsWithAnchors();
    const expectedByType: Record<string, string> = {
      link: 'url',
      image: 'image',
      price: 'price',
    };
    for (const [fieldName, valueType] of Object.entries(expectedByType)) {
      const field = fields.find((candidate) => candidate.type === fieldName);
      expect(`${fieldName}:${valueType}:${field?.anchor?.fingerprint?.expectedValueType}`).toBe(
        `${fieldName}:${valueType}:${valueType}`
      );
    }
    for (const field of fields) {
      expect(field.anchor?.structuralPath).toBeDefined();
      expect(field.anchor?.primary).toBe(field.selector);
    }
  });

  it('keeps the anchors through suggestionsToFieldDefinitions and the field contract', () => {
    catalog();
    const definitions = suggestionsToFieldDefinitions(fieldsWithAnchors());
    const withAnchor = definitions.find((definition) => definition.anchor);
    expect(withAnchor).toBeDefined();
    const parsed = ExtractionFieldSchema.parse(withAnchor);
    expect(parsed.anchor?.primary).toBe(withAnchor?.anchor?.primary);
  });
});

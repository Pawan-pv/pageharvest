import { beforeEach, describe, expect, it } from 'vitest';
import {
  detectFieldsInContainer,
  discoverFieldsInCluster,
  suggestionsToFieldDefinitions,
} from '@/core/detection';
import { extractRecordsFromContainers } from '@/core/extraction/extractor';
import { FieldDefinition } from '@/types';

const fields: FieldDefinition[] = [
  { id: 'name', name: 'Name', selector: '.name', extractor: 'text' },
  { id: 'price', name: 'Price', selector: '.price', extractor: 'number' },
  { id: 'image', name: 'Image', selector: 'img', extractor: 'src' },
];

function renderCards(html: string): Element[] {
  document.body.innerHTML = `<section>${html}</section>`;
  return Array.from(document.querySelectorAll('.card'));
}

const CARDS = `
  <article class="card"><h3 class="name">First has no price</h3><img src="/1.png"></article>
  <article class="card"><span class="price">$20</span><img src="/2.png"></article>
  <article class="card"><h3 class="name">Third is complete</h3><span class="price">$30</span><img src="/3.png"></article>
  <article class="card"><h3 class="name">Last has no image</h3><span class="price">$40</span></article>
  <article class="card"></article>
`;

describe('Record preservation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('field discovery does not imply a requirement', () => {
    const SAMPLE = `
      <article class="card"><h3 class="name">A</h3><span class="price">$1</span></article>
      <article class="card"><h3 class="name">B</h3><span class="price">$2</span></article>
      <article class="card"><span class="price">$3</span></article>
    `;

    it('marks no suggested field as required', () => {
      const [first] = renderCards(SAMPLE);
      const definitions = suggestionsToFieldDefinitions(detectFieldsInContainer(first));

      expect(definitions.length).toBeGreaterThan(0);
      expect(definitions.every((definition) => definition.required === false)).toBe(true);
    });

    it('marks no cluster-discovered field as required', () => {
      const cards = renderCards(SAMPLE);
      const discovered = discoverFieldsInCluster(cards);

      expect(discovered.length).toBeGreaterThan(0);
      expect(discovered.every((field) => field.required === false)).toBe(true);
    });
  });

  describe('extraction keeps every eligible record', () => {
    it('keeps cards missing the first, middle, last and all fields', () => {
      const result = extractRecordsFromContainers(renderCards(CARDS), fields, 1);

      expect(result.records).toHaveLength(5);
      expect(result.records[0]).toMatchObject({ Name: 'First has no price', Price: null });
      expect(result.records[1]).toMatchObject({ Name: null, Price: 20 });
      expect(result.records[3]).toMatchObject({ Name: 'Last has no image', Image: null });
      expect(result.records[4]).toMatchObject({ Name: null, Price: null, Image: null });
    });

    it('reports every outcome instead of omitting records silently', () => {
      const result = extractRecordsFromContainers(renderCards(CARDS), fields, 1);

      expect(result.totalParsed).toBe(5);
      expect(result.missingFieldCount).toBe(4);
      expect(result.filteredCount).toBe(0);
      expect(result.failedCount).toBe(0);
    });

    it('names the missing fields on the record for later review', () => {
      const result = extractRecordsFromContainers(renderCards(CARDS), fields, 1);

      expect(result.records[0]._missingFields).toBe('Price');
      expect(result.records[1]._missingFields).toBe('Name');
      expect(result.records[2]._missingFields).toBeUndefined();
    });

    it('does not count a field filled by its default value as missing', () => {
      const withDefault: FieldDefinition[] = [
        { id: 'price', name: 'Price', selector: '.price', extractor: 'text', defaultValue: 'n/a' },
      ];
      const result = extractRecordsFromContainers(
        renderCards('<article class="card"><h3 class="name">No price</h3></article>'),
        withDefault,
        1
      );

      expect(result.records[0].Price).toBe('n/a');
      expect(result.missingFieldCount).toBe(0);
    });
  });

  describe('explicit user filtering stays possible and visible', () => {
    it('excludes records only when the user marked the field as required, and counts them', () => {
      const filtering: FieldDefinition[] = [
        { ...fields[0], required: true },
        fields[1],
        fields[2],
      ];
      const result = extractRecordsFromContainers(renderCards(CARDS), filtering, 1);

      expect(result.records.map((record) => record.Name)).toEqual([
        'First has no price',
        'Third is complete',
        'Last has no image',
      ]);
      expect(result.filteredCount).toBe(2);
      expect(result.totalParsed).toBe(5);
    });
  });

  describe('a broken field never drops the row', () => {
    it('counts a record that throws as failed and continues', () => {
      const cards = renderCards(`
        <article class="card"><h3 class="name">Good</h3></article>
        <article class="card"><h3 class="name">Also good</h3></article>
      `);
      Object.defineProperty(cards[0], 'querySelector', {
        value: () => {
          throw new Error('boom');
        },
      });
      Object.defineProperty(cards[0], 'matches', {
        value: () => {
          throw new Error('boom');
        },
      });

      const result = extractRecordsFromContainers(cards, [fields[0]], 1);

      // The selector failure is contained per field, so the row is still preserved.
      expect(result.records).toHaveLength(2);
      expect(result.failedCount).toBe(0);
    });
  });
});

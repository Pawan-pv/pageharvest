import { describe, expect, it } from 'vitest';
import { ExtractionFieldSchema } from '@/shared/contracts/field';
import { ExtractionProjectSchema } from '@/shared/contracts/project';
import { ExtractionSchemaSchema } from '@/shared/contracts/schema';
import { DetectedItemSampleSchema } from '@/shared/contracts/detected-list';
import { ExtractionErrorSchema } from '@/shared/contracts/error';
import { contentReadyMessageSchema } from '@/shared/contracts/message';

/**
 * Behavior the contracts had under Zod 3 and must keep under Zod 4 (ADR-035). Zod 4 changed
 * when defaults apply, so each case here would otherwise change silently, with no type error.
 */
describe('Contract parsing kept across the Zod 4 upgrade', () => {
  const field = { id: 'f1', name: 'Title', selector: 'h3 a', extractor: 'text' as const };

  it('leaves regexGroup absent when a field omits it', () => {
    const parsed = ExtractionFieldSchema.parse(field);
    expect('regexGroup' in parsed).toBe(false);
    expect(ExtractionFieldSchema.parse({ ...field, regexGroup: 2 }).regexGroup).toBe(2);
  });

  it('still fills the defaults a field relies on', () => {
    expect(ExtractionFieldSchema.parse(field)).toMatchObject({ required: false, transform: 'trim' });
  });

  it('still rejects an attribute field with no attribute name', () => {
    const result = ExtractionFieldSchema.safeParse({ ...field, extractor: 'attribute' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['attributeName']);
  });

  it('leaves tags absent when a project omits them', () => {
    const parsed = ExtractionProjectSchema.parse({ id: 'p1', name: 'Books' });
    expect('tags' in parsed).toBe(false);
    expect(parsed.status).toBe('draft');
  });

  it('gives a schema with no pagination every pagination default, not only the listed ones', () => {
    const parsed = ExtractionSchemaSchema.parse({
      id: 's1',
      name: 'Books',
      urlPattern: 'https://books.toscrape.com/*',
      containerSelector: 'article.product_pod',
      fields: [field],
    });
    expect(parsed.pagination).toEqual({
      type: 'none',
      maxPages: 20,
      delayMs: 1500,
      scrollCount: 30,
      scrollDelayMs: 1500,
      startPage: 1,
      pageIncrement: 1,
      stopCondition: 'no_new_records',
    });
  });

  it('keeps string-keyed records: attribute values must be strings, error details can be anything', () => {
    const list = DetectedItemSampleSchema.shape.attributes;
    expect(list.parse(undefined)).toEqual({});
    expect(list.safeParse({ class: 'card' }).success).toBe(true);
    expect(list.safeParse({ class: 3 }).success).toBe(false);

    const details = ExtractionErrorSchema.shape.details;
    expect(details.safeParse({ status: 404, retry: { after: 5 } }).success).toBe(true);
  });

  it.each([
    'https://books.toscrape.com/catalogue/page-2.html',
    'http://127.0.0.1:3456/catalog-1.html?page=2#top',
    'file:///C:/fixtures/simple-grid.html',
  ])('accepts the page address %s', (url) => {
    const message = { id: 'm1', type: 'CONTENT_READY', timestamp: 1, payload: { url, title: 'Page' } };
    expect(contentReadyMessageSchema.safeParse(message).success).toBe(true);
  });

  it.each(['', 'not a url', '/catalogue/page-2.html'])('rejects %j as a page address', (url) => {
    const message = { id: 'm1', type: 'CONTENT_READY', timestamp: 1, payload: { url, title: 'Page' } };
    expect(contentReadyMessageSchema.safeParse(message).success).toBe(false);
  });
});

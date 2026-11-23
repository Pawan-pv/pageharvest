import { describe, expect, it } from 'vitest';
import {
  MoreItemsHintSchema,
  BrowserMessageSchema,
  repeatedElementsDetectedMessageSchema,
} from '@/shared/contracts/message';

/**
 * ADR-039: REPEATED_ELEMENTS_DETECTED may say whether the page offers a way to more items.
 * It is display-only and optional, so messages without it parse exactly as before.
 */
const base = {
  id: 'repeated_1',
  type: 'REPEATED_ELEMENTS_DETECTED' as const,
  timestamp: 1,
  payload: {
    containerSelector: 'ul.products > li',
    matchCount: 20,
    sampleSnippets: ['A Light in the Attic 51.77'],
  },
};

describe('REPEATED_ELEMENTS_DETECTED: the moreItems hint', () => {
  it.each(['next', 'load_more', 'none'] as const)('accepts %s', (moreItems) => {
    const parsed = repeatedElementsDetectedMessageSchema.parse({
      ...base,
      payload: { ...base.payload, moreItems },
    });
    expect(parsed.payload.moreItems).toBe(moreItems);
  });

  it('is optional, and absent stays absent', () => {
    const parsed = repeatedElementsDetectedMessageSchema.parse(base);
    expect(parsed.payload).not.toHaveProperty('moreItems');
    expect(BrowserMessageSchema.safeParse(base).success).toBe(true);
  });

  it.each(['scroll', 'yes', '', 1, true, null])('rejects %j', (moreItems) => {
    const result = repeatedElementsDetectedMessageSchema.safeParse({
      ...base,
      payload: { ...base.payload, moreItems },
    });
    expect(result.success).toBe(false);
  });

  it('names exactly the three values the panel words its question by', () => {
    expect(MoreItemsHintSchema.options).toEqual(['next', 'load_more', 'none']);
  });
});

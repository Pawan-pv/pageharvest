import { describe, it, expect } from 'vitest';
import {
  serializeMessage,
  deserializeMessage,
  isValidMessage,
  ExtensionMessage,
  BatchAckSchema,
} from '@/contracts/messages';
import { createMockRecipe, createMockRecord } from '../utils/test-factories';
import { extractionRecipeSchema } from '@/contracts/schemas';

const identity = {
  jobId: 'job_1',
  projectId: 'project_1',
  datasetId: 'dataset_1',
  runId: 'run_1',
  generation: 'gen_1',
};

describe('Extension Message Protocol', () => {
  it('serializes and deserializes PING / PONG messages', () => {
    const ping: ExtensionMessage = {
      id: 'msg_1',
      type: 'PING',
      timestamp: 1700000000000,
      payload: { tabId: 101 }
    };

    const serialized = serializeMessage(ping);
    expect(typeof serialized).toBe('string');

    const deserialized = deserializeMessage(serialized);
    expect(deserialized.type).toBe('PING');
    if (deserialized.type === 'PING') {
      expect(deserialized.payload?.tabId).toBe(101);
    }
  });

  it('serializes and deserializes EXTRACT_RECORDS message', () => {
    const recipe = createMockRecipe();
    const extractMsg: ExtensionMessage = {
      id: 'msg_ext_1',
      type: 'EXTRACT_RECORDS',
      timestamp: Date.now(),
      payload: {
        identity,
        recipe: extractionRecipeSchema.parse(recipe),
        resume: {
          page: 2,
          nextSequence: 2,
          scrollsCompleted: 0,
          catchUpScrolls: 0,
          visitedUrls: [],
          startUrl: 'https://example.com/',
        },
      }
    };

    const serialized = serializeMessage(extractMsg);
    const parsed = deserializeMessage(serialized);

    expect(parsed.type).toBe('EXTRACT_RECORDS');
    if (parsed.type === 'EXTRACT_RECORDS') {
      expect(parsed.payload.resume.page).toBe(2);
      expect(parsed.payload.recipe.containerSelector).toBe(recipe.containerSelector);
      expect(parsed.payload.identity).toEqual(identity);
    }
  });

  it('serializes and deserializes RECORD_BATCH with extracted records', () => {
    const record = createMockRecord({ title: 'Gaming Headset', price: 79.99 });
    const batch: ExtensionMessage = {
      id: 'msg_batch_1',
      type: 'RECORD_BATCH',
      timestamp: Date.now(),
      payload: {
        identity,
        sequence: 1,
        page: 1,
        records: [record],
        stats: { detected: 1, missingFields: 0, filtered: 0, failed: 0, duplicates: 0 },
        navigation: {
          nextPage: 2,
          scrollsCompleted: 0,
          awaitingNavigation: false,
          visitedUrls: [],
          url: 'https://example.com/',
        },
      }
    };

    const serialized = serializeMessage(batch);
    const parsed = deserializeMessage(serialized);

    expect(parsed.type).toBe('RECORD_BATCH');
    if (parsed.type === 'RECORD_BATCH') {
      expect(parsed.payload.records.length).toBe(1);
      expect(parsed.payload.records[0].title).toBe('Gaming Headset');
      expect(parsed.payload.sequence).toBe(1);
    }
  });

  it('rejects a batch without identity or a sequence number', () => {
    const base = {
      id: 'b',
      type: 'RECORD_BATCH',
      timestamp: 1,
      payload: {
        identity,
        sequence: 1,
        page: 1,
        records: [],
        stats: { detected: 0, missingFields: 0, filtered: 0, failed: 0, duplicates: 0 },
        navigation: {
          nextPage: 2,
          scrollsCompleted: 0,
          awaitingNavigation: false,
          visitedUrls: [],
          url: 'https://example.com/',
        },
      },
    };
    expect(isValidMessage(base)).toBe(true);

    const { identity: _identity, ...withoutIdentity } = base.payload;
    expect(isValidMessage({ ...base, payload: withoutIdentity })).toBe(false);

    const { sequence: _sequence, ...withoutSequence } = base.payload;
    expect(isValidMessage({ ...base, payload: withoutSequence })).toBe(false);
  });

  it('validates acknowledgements, so a garbled reply cannot count as durable', () => {
    expect(
      BatchAckSchema.safeParse({ status: 'committed', sequence: 1, inserted: 2, duplicates: 0 }).success
    ).toBe(true);
    expect(BatchAckSchema.safeParse({ status: 'ok' }).success).toBe(false);
    expect(BatchAckSchema.safeParse(undefined).success).toBe(false);
    expect(BatchAckSchema.safeParse({ ok: false, error: 'NO_HANDLER' }).success).toBe(false);
  });

  it('validates messages and rejects invalid structure', () => {
    const valid = {
      id: 'msg_valid',
      type: 'STOP_PICKER',
      timestamp: Date.now()
    };
    expect(isValidMessage(valid)).toBe(true);

    const invalidType = {
      id: 'msg_invalid',
      type: 'NON_EXISTENT_TYPE',
      timestamp: Date.now()
    };
    expect(isValidMessage(invalidType)).toBe(false);

    const missingId = {
      type: 'PING',
      timestamp: Date.now()
    };
    expect(isValidMessage(missingId)).toBe(false);
  });

  it('throws on deserialization of malformed JSON or unknown type', () => {
    expect(() => deserializeMessage('not-valid-json')).toThrow();
    expect(() =>
      deserializeMessage(
        JSON.stringify({
          id: '1',
          type: 'UNKNOWN_OP',
          timestamp: 123
        })
      )
    ).toThrow();
  });
});

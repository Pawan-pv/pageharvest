import { describe, it, expect } from 'vitest';
import {
  serializeMessage,
  deserializeMessage,
  isValidMessage,
  ExtensionMessage
} from '@/contracts/messages';
import { createMockRecipe, createMockRecord } from '../utils/test-factories';

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
        recipe,
        pageNumber: 2
      }
    };

    const serialized = serializeMessage(extractMsg);
    const parsed = deserializeMessage(serialized);

    expect(parsed.type).toBe('EXTRACT_RECORDS');
    if (parsed.type === 'EXTRACT_RECORDS') {
      expect(parsed.payload.pageNumber).toBe(2);
      expect(parsed.payload.recipe.containerSelector).toBe(recipe.containerSelector);
    }
  });

  it('serializes and deserializes EXTRACTION_PROGRESS with extracted records', () => {
    const record = createMockRecord({ title: 'Gaming Headset', price: 79.99 });
    const progressMsg: ExtensionMessage = {
      id: 'msg_prog_1',
      type: 'EXTRACTION_PROGRESS',
      timestamp: Date.now(),
      payload: {
        page: 1,
        records: [record],
        newRecordsCount: 1,
        duplicatesCount: 0,
        isComplete: false
      }
    };

    const serialized = serializeMessage(progressMsg);
    const parsed = deserializeMessage(serialized);

    expect(parsed.type).toBe('EXTRACTION_PROGRESS');
    if (parsed.type === 'EXTRACTION_PROGRESS') {
      expect(parsed.payload.records.length).toBe(1);
      expect(parsed.payload.records[0].title).toBe('Gaming Headset');
    }
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

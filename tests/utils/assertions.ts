import { expect } from 'vitest';
import { ExtractedRecord } from '@/types';
import { ExtensionMessage } from '@/contracts';

export function assertValidRecord(record: unknown): asserts record is ExtractedRecord {
  expect(record).toBeDefined();
  expect(typeof record).toBe('object');
  const r = record as Record<string, unknown>;
  expect(typeof r._id).toBe('string');
  expect(typeof r._id === 'string' && r._id.length > 0).toBe(true);
  expect(typeof r._page).toBe('number');
  expect(typeof r._extractedAt).toBe('number');
}

export function assertValidMessage(message: unknown): asserts message is ExtensionMessage {
  expect(message).toBeDefined();
  expect(typeof message).toBe('object');
  const m = message as Record<string, unknown>;
  expect(typeof m.id).toBe('string');
  expect(typeof m.type).toBe('string');
  expect(typeof m.timestamp).toBe('number');
}

export function assertNoEmptyFields(record: ExtractedRecord, requiredFields: string[]): void {
  for (const field of requiredFields) {
    expect(record[field]).toBeDefined();
    expect(record[field]).not.toBeNull();
    expect(record[field]).not.toBe('');
  }
}

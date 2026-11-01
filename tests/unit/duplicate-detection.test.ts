import { describe, it, expect } from 'vitest';
import {
  computeRecordHash,
  generateRecordSignature,
  DuplicateDetector
} from '@/core/extraction/duplicate-detector';

describe('Duplicate Detection & Content Hashing', () => {
  it('generates consistent hashes for identical content', () => {
    const recordA = { title: 'Gaming Laptop', price: 1200 };
    const recordB = { title: 'Gaming Laptop', price: 1200 };

    expect(computeRecordHash(recordA)).toBe(computeRecordHash(recordB));
  });

  it('ignores metadata fields (_id, _page, _extractedAt) during hash computation', () => {
    const record1 = {
      _id: 'rec_aaa',
      _page: 1,
      _extractedAt: 1000000,
      title: 'Gaming Laptop',
      price: 1200
    };

    const record2 = {
      _id: 'rec_bbb',
      _page: 2,
      _extractedAt: 2000000,
      title: 'Gaming Laptop',
      price: 1200
    };

    expect(computeRecordHash(record1)).toBe(computeRecordHash(record2));
  });

  it('detects case and whitespace normalization variations', () => {
    const record1 = { title: 'Gaming Laptop  ', price: 1200 };
    const record2 = { title: '  gaming laptop', price: 1200 };

    expect(computeRecordHash(record1)).toBe(computeRecordHash(record2));
  });

  it('produces different hashes for different content', () => {
    const recordA = { title: 'Gaming Laptop', price: 1200 };
    const recordB = { title: 'Office Laptop', price: 800 };

    expect(computeRecordHash(recordA)).not.toBe(computeRecordHash(recordB));
  });

  describe('DuplicateDetector instance tracking', () => {
    it('flags repeated records and updates duplicate counter', () => {
      const detector = new DuplicateDetector();

      const item1 = { title: 'Mouse', price: 25 };
      const item2 = { title: 'Keyboard', price: 75 };
      const item1Duplicate = { title: 'Mouse', price: 25 };

      const res1 = detector.process(item1);
      expect(res1.isDuplicate).toBe(false);
      expect(res1.uniqueCount).toBe(1);
      expect(res1.duplicateCount).toBe(0);

      const res2 = detector.process(item2);
      expect(res2.isDuplicate).toBe(false);
      expect(res2.uniqueCount).toBe(2);

      const res3 = detector.process(item1Duplicate);
      expect(res3.isDuplicate).toBe(true);
      expect(res3.uniqueCount).toBe(2);
      expect(res3.duplicateCount).toBe(1);

      const stats = detector.getStats();
      expect(stats.totalProcessed).toBe(3);
      expect(stats.uniqueCount).toBe(2);
      expect(stats.duplicateCount).toBe(1);
    });

    it('clears state on reset', () => {
      const detector = new DuplicateDetector();
      detector.process({ title: 'Item 1' });
      expect(detector.getStats().uniqueCount).toBe(1);

      detector.clear();
      expect(detector.getStats().uniqueCount).toBe(0);
      expect(detector.getStats().duplicateCount).toBe(0);
    });
  });
});

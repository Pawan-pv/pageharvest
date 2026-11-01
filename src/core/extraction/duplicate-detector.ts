import { ExtractedRecord } from '@/types';

/**
 * Computes a fast, deterministic 32-bit FNV-1a hash of a string.
 */
export function fnv1aHash(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Generates a normalized content signature for a record, ignoring internal metadata
 * (_id, _page, _extractedAt).
 */
export function generateRecordSignature(
  record: Record<string, unknown>,
  selectedFields?: string[]
): string {
  const keys = (selectedFields && selectedFields.length > 0
    ? selectedFields
    : Object.keys(record)
  )
    .filter((k) => !k.startsWith('_'))
    .sort();

  const pairs: string[] = [];
  for (const key of keys) {
    const val = record[key];
    const normalizedVal = val === null || val === undefined ? '' : String(val).trim().toLowerCase();
    pairs.push(`${key}:${normalizedVal}`);
  }

  return pairs.join('|');
}

/**
 * Computes a deterministic content hash for an extracted record.
 */
export function computeRecordHash(
  record: Record<string, unknown>,
  selectedFields?: string[]
): string {
  const signature = generateRecordSignature(record, selectedFields);
  return fnv1aHash(signature);
}

/**
 * In-memory duplicate detector tracking seen record hashes during an extraction session.
 */
export class DuplicateDetector {
  private seenHashes = new Set<string>();
  private duplicateCount = 0;
  private uniqueCount = 0;

  /**
   * Evaluates a record. Returns whether it is a duplicate and its hash.
   * If unique, registers the hash.
   */
  public process(
    record: Record<string, unknown>,
    selectedFields?: string[]
  ): { isDuplicate: boolean; hash: string; duplicateCount: number; uniqueCount: number } {
    const hash = computeRecordHash(record, selectedFields);
    if (this.seenHashes.has(hash)) {
      this.duplicateCount++;
      return {
        isDuplicate: true,
        hash,
        duplicateCount: this.duplicateCount,
        uniqueCount: this.uniqueCount
      };
    }

    this.seenHashes.add(hash);
    this.uniqueCount++;
    return {
      isDuplicate: false,
      hash,
      duplicateCount: this.duplicateCount,
      uniqueCount: this.uniqueCount
    };
  }

  public has(hash: string): boolean {
    return this.seenHashes.has(hash);
  }

  public getStats() {
    return {
      totalProcessed: this.duplicateCount + this.uniqueCount,
      uniqueCount: this.uniqueCount,
      duplicateCount: this.duplicateCount
    };
  }

  public clear(): void {
    this.seenHashes.clear();
    this.duplicateCount = 0;
    this.uniqueCount = 0;
  }
}

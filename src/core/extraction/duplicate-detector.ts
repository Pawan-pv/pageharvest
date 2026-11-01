import { canonicalizeRecord } from './record-identity';

/**
 * Returns the canonical signature that identifies a record's content.
 */
export function generateRecordSignature(
  record: Record<string, unknown>,
  selectedFields?: string[]
): string {
  return canonicalizeRecord(record, selectedFields);
}

/**
 * Tracks record signatures during a single extraction run in the page.
 *
 * It stores full canonical signatures rather than hashes, so equality is exact and
 * collisions are impossible. Durable, cross-document deduplication happens in the
 * background job coordinator when a batch is committed.
 */
export class DuplicateDetector {
  private duplicateCount = 0;
  private uniqueCount = 0;

  constructor(private readonly seen: Set<string> = new Set<string>()) {}

  /**
   * Evaluates a record. If it has not been seen, registers its signature.
   */
  public process(
    record: Record<string, unknown>,
    selectedFields?: string[]
  ): { isDuplicate: boolean; signature: string; duplicateCount: number; uniqueCount: number } {
    const signature = generateRecordSignature(record, selectedFields);
    if (this.seen.has(signature)) {
      this.duplicateCount++;
      return {
        isDuplicate: true,
        signature,
        duplicateCount: this.duplicateCount,
        uniqueCount: this.uniqueCount,
      };
    }

    this.seen.add(signature);
    this.uniqueCount++;
    return {
      isDuplicate: false,
      signature,
      duplicateCount: this.duplicateCount,
      uniqueCount: this.uniqueCount,
    };
  }

  public has(signature: string): boolean {
    return this.seen.has(signature);
  }

  public getStats() {
    return {
      totalProcessed: this.duplicateCount + this.uniqueCount,
      uniqueCount: this.uniqueCount,
      duplicateCount: this.duplicateCount,
    };
  }

  public clear(): void {
    this.seen.clear();
    this.duplicateCount = 0;
    this.uniqueCount = 0;
  }
}

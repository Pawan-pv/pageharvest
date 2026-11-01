import { isRecordMetadataKey } from '@/shared/contracts/record';

/**
 * Record identity: what makes two extracted rows "the same row".
 *
 * The canonical form is the identity. The SHA-256 fingerprint only narrows down
 * which stored rows to compare; two rows are duplicates only when their canonical
 * forms are equal, so a hash collision can never remove a distinct record.
 *
 * Normalization rules, applied to values only:
 * - Strings are Unicode NFC, trimmed, with whitespace runs collapsed to one space.
 * - Letter case is preserved: "SKU-aB3" and "SKU-Ab3" are different records.
 * - null, undefined and empty strings all mean "no value" and are left out, so a
 *   missing field and a field that was never selected compare equal.
 * - Numbers and booleans keep their type, so 5 and "5" are different.
 * - Provenance metadata (see isRecordMetadataKey) is never part of identity.
 */
export const RECORD_IDENTITY_VERSION = 'canonical-v1+sha256';

export type HashFunction = (canonical: string) => Promise<string>;

function normalizeValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const normalized = value.normalize('NFC').replace(/\s+/g, ' ').trim();
    return normalized === '' ? null : normalized;
  }
  if (typeof value === 'number') return Number.isNaN(value) ? null : value;
  if (typeof value === 'boolean') return value;
  return String(value);
}

/**
 * Produces the stable canonical string for a record: field names in sorted order,
 * JSON-encoded so that no value can imitate a field separator.
 */
export function canonicalizeRecord(
  record: Record<string, unknown>,
  selectedFields?: string[]
): string {
  const keys = (selectedFields && selectedFields.length > 0 ? selectedFields : Object.keys(record))
    .filter((key) => !isRecordMetadataKey(key))
    .sort();

  const pairs: Array<[string, string | number | boolean]> = [];
  for (const key of keys) {
    const value = normalizeValue(record[key]);
    if (value !== null) pairs.push([key, value]);
  }
  return JSON.stringify(pairs);
}

/**
 * SHA-256 of a canonical string, as lowercase hex. Uses Web Crypto, which is
 * available in the service worker. There is deliberately no weak fallback.
 */
export const sha256Hex: HashFunction = async (canonical) => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('Web Crypto is unavailable, so record fingerprints cannot be computed.');
  }
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

export interface RecordFingerprint {
  canonical: string;
  hash: string;
}

export async function fingerprintRecord(
  record: Record<string, unknown>,
  hash: HashFunction = sha256Hex
): Promise<RecordFingerprint> {
  const canonical = canonicalizeRecord(record);
  return { canonical, hash: await hash(canonical) };
}

/**
 * DOM Value Extraction and Normalization Utilities
 */

/**
 * Normalizes text by trimming and collapsing multiple whitespace characters.
 */
export function normalizeText(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Resolves a relative URL or path against the current document base URL.
 */
export function resolveAbsoluteUrl(relativeUrl: string | null | undefined, baseUrl?: string): string {
  if (!relativeUrl) return '';
  const trimmed = relativeUrl.trim();
  if (!trimmed || trimmed.startsWith('javascript:') || trimmed.startsWith('data:')) {
    return trimmed;
  }

  try {
    const base = baseUrl || (typeof window !== 'undefined' ? window.location.href : 'http://localhost');
    return new URL(trimmed, base).href;
  } catch {
    return trimmed;
  }
}

/**
 * Parses numbers, prices, and percentages from text.
 * e.g. "$1,299.99" -> 1299.99
 * " -45.50 %" -> -45.5
 */
export function parseNumberValue(text: string | null | undefined): number | null {
  if (!text) return null;
  const cleaned = text.replace(/,/g, '').trim();
  const match = cleaned.match(/[-+]?\d*\.?\d+/);
  if (!match) return null;
  const num = parseFloat(match[0]);
  return isNaN(num) ? null : num;
}

/**
 * Computes a fast deterministic 32-bit FNV-1a hash of a string.
 * Used for duplicate record detection without external heavy crypto libraries.
 */
export function hashString(str: string): string {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    // Multiply by 32-bit FNV prime 16777619
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Generates a unique fingerprint for a record based on its extracted fields.
 */
export function computeRecordHash(data: Record<string, unknown>, ignoredKeys = ['_id', '_page', '_extractedAt']): string {
  const sortedKeys = Object.keys(data)
    .filter((k) => !ignoredKeys.includes(k))
    .sort();

  const combined = sortedKeys
    .map((k) => `${k}:${String(data[k] ?? '')}`)
    .join('|');

  return hashString(combined);
}

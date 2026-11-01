import { FieldExtractorType } from '@/types';

/**
 * Normalizes text content: trims, collapses multiple whitespaces,
 * converts non-breaking spaces (\u00A0) to standard spaces.
 */
export function normalizeText(val: string | null | undefined): string {
  if (val === null || val === undefined) return '';
  return val
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalizes and extracts numeric values from string text (e.g. "$1,299.99", "€ 49,99", "1.450,00 €", "-$25.50").
 * Handles currency symbols, thousands commas/dots, negative numbers, and European decimal commas.
 */
export function normalizeNumber(val: string | number | null | undefined): number | null {
  if (typeof val === 'number') {
    return isNaN(val) ? null : val;
  }
  if (!val || typeof val !== 'string') return null;

  const cleaned = val.trim();
  if (cleaned.length === 0) return null;

  // Check for negative indicator (-15%, -$25.50, ($25.50))
  const isNegative = /^[-−]|\([$€£¥]?\d|[-−][$€£¥]/.test(cleaned);

  let normalized = cleaned;
  if (/\d+\.\d{3},\d{2}/.test(normalized)) {
    // European thousands dot with decimal comma: "1.450,00"
    normalized = normalized.replace(/\./g, '').replace(/,/g, '.');
  } else if (/,\d{1,2}\s*[$€£¥]?$/.test(normalized) && !/\.\d+/.test(normalized)) {
    // Decimal comma without dots: "49,99" or "49,99 €"
    normalized = normalized.replace(/,/g, '.');
  } else {
    // Standard format: remove thousands commas "1,450.00"
    normalized = normalized.replace(/,/g, '');
  }

  // Extract match of digits and decimal portion
  const match = normalized.match(/\d+(?:\.\d+)?/);
  if (!match) return null;

  const parsed = parseFloat(match[0]);
  if (isNaN(parsed)) return null;

  return isNegative ? -parsed : parsed;
}

/**
 * Resolves relative URLs into absolute URLs using base URL context.
 */
export function normalizeUrl(
  relativeOrAbsolute: string | null | undefined,
  baseUrl: string = 'http://localhost'
): string | null {
  if (!relativeOrAbsolute || typeof relativeOrAbsolute !== 'string') return null;
  const trimmed = relativeOrAbsolute.trim();
  if (trimmed.length === 0 || trimmed.startsWith('javascript:')) return null;

  const effectiveBase = !baseUrl || baseUrl === 'about:blank' ? 'http://localhost' : baseUrl;

  try {
    const resolved = new URL(trimmed, effectiveBase);
    return resolved.href;
  } catch {
    return null;
  }
}

/**
 * Extracts regex captured group from text.
 */
export function normalizeRegex(
  val: string | null | undefined,
  pattern: string,
  groupIndex: number = 0
): string | null {
  if (!val || !pattern) return null;
  try {
    const rx = new RegExp(pattern);
    const match = val.match(rx);
    if (!match) return null;
    return match[groupIndex] !== undefined ? match[groupIndex] : null;
  } catch {
    return null;
  }
}

/**
 * Master dispatcher for field normalization.
 */
export function normalizeFieldValue(
  rawValue: unknown,
  extractor: FieldExtractorType,
  options: {
    baseUrl?: string;
    regexPattern?: string;
    regexGroup?: number;
    defaultValue?: string;
  } = {}
): string | number | null {
  let result: string | number | null = null;

  switch (extractor) {
    case 'text':
      result = normalizeText(typeof rawValue === 'string' ? rawValue : String(rawValue || ''));
      break;

    case 'number':
      result = normalizeNumber(typeof rawValue === 'string' || typeof rawValue === 'number' ? rawValue : null);
      break;

    case 'href':
    case 'src': {
      const defaultBase =
        typeof window !== 'undefined' && window.location && window.location.href !== 'about:blank'
          ? window.location.href
          : 'http://localhost';
      result = normalizeUrl(typeof rawValue === 'string' ? rawValue : null, options.baseUrl || defaultBase);
      break;
    }

    case 'regex':
      result = normalizeRegex(
        typeof rawValue === 'string' ? rawValue : String(rawValue || ''),
        options.regexPattern || '',
        options.regexGroup ?? 0
      );
      break;

    case 'attribute':
    case 'html':
    default:
      result = typeof rawValue === 'string' ? rawValue.trim() : (rawValue != null ? String(rawValue) : null);
      break;
  }

  if ((result === null || result === '') && options.defaultValue !== undefined) {
    return options.defaultValue;
  }

  return result;
}

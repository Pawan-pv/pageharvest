import { parseNumberDetailed } from './number-parser';

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
 * The text a person would read in an element. textContent also includes the contents of
 * style and script tags, which some sites put inside every card.
 */
export function visibleText(element: Element): string {
  if (!element.querySelector('style, script, noscript, template')) {
    return normalizeText(element.textContent);
  }
  const copy = element.cloneNode(true) as Element;
  copy.querySelectorAll('style, script, noscript, template').forEach((node) => node.remove());
  return normalizeText(copy.textContent);
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
 * Reads one number from text, or null if the text has none or is not certain.
 * Use parseNumberDetailed to learn why, and to keep ranges and the original text.
 */
export function parseNumberValue(text: string | null | undefined): number | null {
  return parseNumberDetailed(text).value;
}

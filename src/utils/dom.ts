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

/**
 * Every PageHarvest overlay host opts itself out of the page's own change
 * detection with this attribute, so that overlay animations can never be
 * mistaken for real page mutations by extraction observers.
 */
const OVERLAY_IGNORE_ATTRIBUTE = 'data-pageharvest-ignore';

/**
 * Reports whether a mutated node belongs to a PageHarvest overlay host (or is one).
 * Accepts any Node: elements are walked with `closest`, other node types climb
 * through `parentElement`.
 */
export function isPageHarvestOverlayNode(node: Node): boolean {
  let current: Node | null = node;
  while (current) {
    if (current instanceof Element && current.closest(`[${OVERLAY_IGNORE_ATTRIBUTE}]`)) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

/**
 * Reports whether a mutation record was caused exclusively by PageHarvest overlay
 * activity. Records that only add or remove overlay-owned nodes (e.g. mounting or
 * animating an overlay host) count as overlay activity, even when the observed
 * target is the page body; attribute or characterData changes count only when they
 * target an overlay node.
 */
export function isPageHarvestOverlayMutation(record: MutationRecord): boolean {
  const changed: Node[] = [...record.addedNodes, ...record.removedNodes];
  if (changed.length > 0) {
    return changed.every((node) => isPageHarvestOverlayNode(node));
  }
  return isPageHarvestOverlayNode(record.target);
}

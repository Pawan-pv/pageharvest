/**
 * Safe DOM query execution.
 *
 * Selectors generated from page content (class names, ids, attribute values) can
 * be invalid CSS. Every call site that evaluates a generated selector goes
 * through these helpers, which catch the DOMException and degrade to an empty
 * result instead of letting the extraction loop crash.
 */

export function safeQueryAll(root: Document | Element | null, selector: string): Element[] {
  if (!root || !selector) return [];
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [];
  }
}

export function safeQuery(root: Document | Element | null, selector: string): Element | null {
  if (!root || !selector) return null;
  try {
    return root.querySelector(selector);
  } catch {
    return null;
  }
}

/** `element.matches()` with the same degrade-to-false semantics. */
export function safeMatches(element: Element | null, selector: string): boolean {
  if (!element || !selector) return false;
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

/** True when `matches:`-style evaluation must be skipped for a selector. */
export function isSafeSelector(selector: string): boolean {
  if (!selector) return false;
  try {
    document.createDocumentFragment().querySelector(selector);
    return true;
  } catch {
    return false;
  }
}

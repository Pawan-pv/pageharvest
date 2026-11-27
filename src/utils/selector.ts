/**
 * DOM Selector Generation Utilities
 */

/**
 * Escapes an attribute value for double-quoted CSS attribute selectors.
 */
function escapeAttrValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Returns true if `id` is non-empty and uniquely identifies a single element in `root`.
 * Duplicate IDs on real-world pages (e.g. infinite-scroll chunks reusing id="grid") return false.
 */
export function isUniqueId(id: string, root: Document | Element = document): boolean {
  if (!id || typeof id !== 'string') return false;
  const trimmed = id.trim();
  if (!trimmed) return false;
  try {
    return root.querySelectorAll(`[id="${escapeAttrValue(trimmed)}"]`).length === 1;
  } catch {
    return false;
  }
}

/**
 * Checks if an ID appears to be dynamically generated (e.g., ember123, :r1:, gen-482)
 */
export function isDynamicId(id: string): boolean {
  if (!id) return true;
  const trimmed = id.trim();
  if (!trimmed) return true;
  if (/^[0-9]/.test(trimmed)) return true;
  if (/[:/\\#.[\]]/.test(trimmed)) return true;
  if (/^(sc|css|jss|styled|mui|tw|emotion)-[a-zA-Z0-9_-]+$/i.test(trimmed)) return true;
  if (/react-select-.*input/i.test(trimmed)) return true;
  if (/uid-[0-9a-zA-Z]+/i.test(trimmed)) return true;
  if (/ember\d+/i.test(trimmed)) return true;
  if (/(ember|react|vue|ng|guid|gen|uid|item|radix|headlessui|chakra|next)-?[0-9a-f]{4,}/i.test(trimmed)) {
    return true;
  }
  if (/^\d+$/.test(trimmed)) return true;
  if (/^[a-f0-9]{8,}$/i.test(trimmed)) return true;
  if (trimmed.length >= 10 && /[A-Z]/.test(trimmed) && /[a-z]/.test(trimmed) && /[0-9]/.test(trimmed)) {
    return true;
  }
  return false;
}

const TRANSIENT_STATE_CLASS_RE =
  /^(active|hover|focus|focus-within|selected|open|closed|is-.*|has-.*|js-.*|slick-.*|swiper-.*|visible|hidden|disabled|loading|expanded|collapsed)$/i;
const CSS_IN_JS_CLASS_RE = /^(?:css|sc|jss|styled|mui|tw|emotion)-[a-zA-Z0-9_-]+$/i;
const CSS_MODULE_HASH_RE = /(?:__[a-zA-Z0-9_-]*_[a-zA-Z0-9]{4,}|_[a-zA-Z0-9]{5,})$/;

/**
 * Detects utility, presentation-only, framework-hashed, and transient UI state classes.
 */
export function isVolatileOrUtilityClass(cls: string): boolean {
  if (!cls || typeof cls !== 'string') return true;
  const c = cls.trim();
  if (c.length === 0) return true;

  if (TRANSIENT_STATE_CLASS_RE.test(c)) return true;
  if (c.includes(':') || c.includes('[') || c.includes(']')) return true;
  if (CSS_IN_JS_CLASS_RE.test(c) || CSS_MODULE_HASH_RE.test(c)) return true;
  // Mixed-case + digit random hashes without semantic separators (e.g. a1B2c3)
  if (c.length >= 6 && /^[a-z0-9]+$/i.test(c) && /[A-Z]/.test(c) && /[a-z]/.test(c) && /[0-9]/.test(c)) {
    return true;
  }

  // Layout & display utility classes
  if (/^(flex|inline-flex|grid|inline-grid|block|inline-block|inline|contents|hidden)$/i.test(c)) {
    return true;
  }
  if (/^(items|justify|content|self|place)-(start|end|center|between|around|evenly|stretch|baseline)/i.test(c)) {
    return true;
  }
  if (/^(flex-(row|col|row-reverse|col-reverse|wrap|nowrap)|grow|shrink|basis-\w+)$/i.test(c)) {
    return true;
  }
  if (/^(grid-cols-\d+|col-span-\d+|grid-rows-\d+|row-span-\d+|gap(-\w+)?-\d+|space-[xy]-\d+)$/i.test(c)) {
    return true;
  }

  // Spacing, sizing, typography, borders, colors, positioning
  if (/^[-+]?[pm][trblxy]?(-\w+)?-\d+$/i.test(c)) return true;
  if (/^(w|h|min-w|min-h|max-w|max-h)(-\w+)?-\w+$/i.test(c)) return true;
  if (/^text-(xs|sm|base|lg|xl|\d+xl|left|center|right|justify)$/i.test(c)) return true;
  if (/^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/i.test(c)) return true;
  if (/^(leading|tracking)-(none|tight|snug|normal|relaxed|loose|wide|wider|widest|\d+)$/i.test(c)) return true;
  if (/^(rounded|border|shadow|ring|divide)(-\w+)?$/i.test(c)) return true;
  if (/^(bg|text|border|fill|stroke|ring)-([a-z]+-\d+|white|black|transparent|current)$/i.test(c)) return true;
  if (/^(relative|absolute|fixed|sticky|static|top-\d+|bottom-\d+|left-\d+|right-\d+|inset-\d+|z-\d+)$/i.test(c)) {
    return true;
  }
  if (/^(overflow|opacity|transition|duration|cursor)(-\w+)?$/i.test(c)) return true;

  return false;
}

/**
 * Filter meaningful classes (avoid framework-generated classes, Tailwind utilities, or active states)
 */
export function filterMeaningfulClasses(classList: DOMTokenList | string[]): string[] {
  const classes = Array.isArray(classList) ? classList : Array.from(classList);
  return classes.filter((cls) => !isVolatileOrUtilityClass(cls));
}

const DURABLE_CONTAINER_ATTRS = [
  'data-testid',
  'data-test-id',
  'data-test',
  'data-qa',
  'data-cy',
  'data-component',
  'data-automation-id',
  'itemprop',
  'itemtype',
  'role',
] as const;

/**
 * Returns a stable semantic attribute selector (e.g. `[data-testid="items-grid"]`) when present.
 */
export function getDurableAttributeSelector(element: Element): string | null {
  for (const attr of DURABLE_CONTAINER_ATTRS) {
    const val = element.getAttribute(attr);
    if (val && val.trim().length > 0 && val.trim().length < 80 && !isDynamicId(val)) {
      return `[${attr}="${escapeAttrValue(val.trim())}"]`;
    }
  }
  return null;
}

/**
 * Escape CSS identifier for use in selector
 */
export function escapeCss(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/([^\w-])/g, '\\$1');
}

/**
 * Generate a unique CSS selector for an element within the entire document.
 */
export function generateCssSelector(element: Element): string {
  if (!(element instanceof Element)) {
    return '';
  }

  // 1. Unique ID
  if (element.id && !isDynamicId(element.id) && isUniqueId(element.id, document)) {
    const idSelector = `#${escapeCss(element.id)}`;
    try {
      if (document.querySelectorAll(idSelector).length === 1) {
        return idSelector;
      }
    } catch {
      // Continue if selector is invalid
    }
  }

  // 2. Meaningful class combination
  const tagName = element.tagName.toLowerCase();
  const classes = filterMeaningfulClasses(element.classList);
  if (classes.length > 0) {
    const classSelector = `${tagName}.${classes.map(escapeCss).join('.')}`;
    try {
      if (document.querySelectorAll(classSelector).length === 1) {
        return classSelector;
      }
    } catch {
      // Continue
    }
  }

  // 3. Ascend hierarchy to root
  const path: string[] = [];
  let current: Element | null = element;

  while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body && current !== document.documentElement) {
    let selector = current.tagName.toLowerCase();

    if (current.id && !isDynamicId(current.id) && isUniqueId(current.id, document)) {
      selector += `#${escapeCss(current.id)}`;
      path.unshift(selector);
      break; // Safe anchor
    }

    const meaningful = filterMeaningfulClasses(current.classList);
    if (meaningful.length > 0) {
      selector += `.${meaningful.slice(0, 2).map(escapeCss).join('.')}`;
    }

    // Determine sibling index if there are siblings with same selector
    const parent: Element | null = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter((c) => {
        try {
          return c.matches(selector);
        } catch {
          return c.tagName === current?.tagName;
        }
      });

      if (siblings.length > 1) {
        const index = Array.from(parent.children).indexOf(current) + 1;
        selector += `:nth-child(${index})`;
      }
    }

    path.unshift(selector);
    current = current.parentElement;
  }

  return path.join(' > ');
}

/**
 * Generate a minimal relative selector for a target element relative to its container element.
 */
export function generateRelativeSelector(container: Element, target: Element): string {
  if (container === target) {
    return '';
  }

  // Check if target is a direct match by distinctive class or tag
  const tagName = target.tagName.toLowerCase();
  const classes = filterMeaningfulClasses(target.classList);

  if (classes.length > 0) {
    const candidate = `${tagName}.${classes.map(escapeCss).join('.')}`;
    try {
      if (container.querySelectorAll(candidate).length === 1) {
        return candidate;
      }
    } catch {
      // Fall through
    }
  }

  // Try just tag name if unique inside container (e.g. h2, img, a)
  try {
    if (container.querySelectorAll(tagName).length === 1) {
      return tagName;
    }
  } catch {
    // Fall through
  }

  // Ascend from target up to container
  const segments: string[] = [];
  let current: Element | null = target;

  while (current && current !== container && current.parentElement) {
    let part = current.tagName.toLowerCase();
    const currClasses = filterMeaningfulClasses(current.classList);
    if (currClasses.length > 0) {
      part += `.${escapeCss(currClasses[0])}`;
    }

    const parent = current.parentElement;
    const matchingSiblings = Array.from(parent.children).filter((c) => {
      try {
        return c.matches(part);
      } catch {
        return c.tagName === current?.tagName;
      }
    });

    if (matchingSiblings.length > 1) {
      const index = Array.from(parent.children).indexOf(current) + 1;
      part += `:nth-child(${index})`;
    }

    segments.unshift(part);
    current = current.parentElement;
  }

  return segments.join(' > ');
}

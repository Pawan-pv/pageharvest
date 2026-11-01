/**
 * DOM Selector Generation Utilities
 */

/**
 * Checks if an ID appears to be dynamically generated (e.g., ember123, :r1:, gen-482)
 */
export function isDynamicId(id: string): boolean {
  if (!id) return true;
  if (/^[0-9]/.test(id)) return true;
  if (id.includes('/') || /[:\\]/.test(id)) return true;
  if (/^(sc|css|jss)-[a-zA-Z0-9]+$/i.test(id)) return true;
  if (/react-select-.*input/i.test(id)) return true;
  if (/uid-[0-9a-zA-Z]+/i.test(id)) return true;
  if (/ember\d+/i.test(id)) return true;
  if (/(ember|react|vue|ng|guid|gen|uid|item)-?[0-9a-f]{4,}/i.test(id)) return true;
  if (/^[a-f0-9]{8,}$/i.test(id)) return true;
  return false;
}

/**
 * Filter meaningful classes (avoid framework-generated classes or active states)
 */
export function filterMeaningfulClasses(classList: DOMTokenList | string[]): string[] {
  const classes = Array.isArray(classList) ? classList : Array.from(classList);
  return classes.filter((cls) => {
    if (!cls || cls.trim() === '') return false;
    // Skip active/state classes that change on hover/focus
    if (/^(active|hover|focus|selected|open|closed|visible|hidden|disabled|loading|expanded)$/i.test(cls)) {
      return false;
    }
    // Skip dynamic hash classes e.g. css-12x9a, sc-bdVaJa, jss123
    if (/^(css|sc|jss|styled)-[a-zA-Z0-9]+$/i.test(cls)) {
      return false;
    }
    // Avoid Tailwind arbitrary values or states like hover:bg-blue-500
    if (cls.includes(':') || cls.includes('[') || cls.includes(']')) {
      return false;
    }
    return true;
  });
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
  if (element.id && !isDynamicId(element.id)) {
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

    if (current.id && !isDynamicId(current.id)) {
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

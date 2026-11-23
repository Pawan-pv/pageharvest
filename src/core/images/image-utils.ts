/**
 * Image discovery, srcset parser, filename template interpolation, and cross-platform filename sanitizer.
 */

export interface ImageItem {
  id: string;
  url: string;
  alt: string;
  width: number;
  height: number;
  extension: string;
  pageUrl: string;
  recordData?: Record<string, unknown>;
}

const COMMON_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'svg', 'gif', 'bmp', 'tiff', 'ico', 'avif']);

/**
 * Extracts a clean extension from an image URL, defaulting to 'jpg' if unknown or query-parameter bound.
 */
export function extractImageExtension(url: string): string {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    const lastDot = pathname.lastIndexOf('.');
    if (lastDot !== -1) {
      const ext = pathname.slice(lastDot + 1).toLowerCase().split(/[?#]/)[0];
      if (COMMON_IMAGE_EXTENSIONS.has(ext)) {
        return ext === 'jpeg' ? 'jpg' : ext;
      }
    }
  } catch {
    // Ignore
  }
  return 'jpg';
}

/**
 * Parses a standard HTML srcset attribute and selects the highest-width/density URL.
 */
export function parseSrcset(srcset: string): string {
  if (!srcset || !srcset.trim()) return '';

  const entries = srcset.split(',').map((part) => part.trim()).filter(Boolean);
  let bestUrl = '';
  let highestValue = -1;

  for (const entry of entries) {
    const [rawUrl, descriptor] = entry.split(/\s+/);
    if (!rawUrl) continue;

    let value = 1;
    if (descriptor) {
      if (descriptor.endsWith('w')) {
        value = parseInt(descriptor.slice(0, -1), 10) || 1;
      } else if (descriptor.endsWith('x')) {
        value = (parseFloat(descriptor.slice(0, -1)) || 1) * 1000;
      }
    }

    if (value > highestValue) {
      highestValue = value;
      bestUrl = rawUrl;
    }
  }

  return bestUrl || entries[0]?.split(/\s+/)[0] || '';
}

/**
 * Sanitizes a filename component so it is cross-platform safe (Windows, macOS, Linux).
 * Strips reserved characters: < > : " / \ | ? * and control chars.
 * Prevents directory traversal (..) and trims trailing periods/spaces.
 */
export function sanitizeFilenamePart(part: string): string {
  if (!part) return '';

  let sanitized = part
    // Replace reserved characters
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    // Prevent path traversal
    .replace(/\.{2,}/g, '_')
    // Collapse multiple underscores/spaces
    .replace(/[\s_]+/g, '_')
    .trim()
    // Trim trailing and leading periods, spaces, underscores
    .replace(/[. _]+$/, '')
    .replace(/^[. _]+/, '');

  // Clamp length
  if (sanitized.length > 100) {
    sanitized = sanitized.slice(0, 100);
  }

  return sanitized;
}

/**
 * Interpolates filename templates such as "{vendor}-{title}-{index}.{ext}" or "PageHarvest/{domain}/{alt}-{index}.{ext}".
 */
export function interpolateFilenameTemplate(
  template: string,
  context: {
    index: number;
    domain: string;
    alt?: string;
    ext?: string;
    record?: Record<string, unknown>;
  }
): string {
  const indexStr = String(context.index + 1).padStart(3, '0');
  const domainClean = sanitizeFilenamePart(context.domain || 'site');
  const altClean = sanitizeFilenamePart(context.alt || 'image');
  const ext = (context.ext || 'jpg').toLowerCase().replace(/^\./, '');

  let filename = template;

  // 1. Built-in tokens
  filename = filename.replace(/\{index\}/gi, indexStr);
  filename = filename.replace(/\{domain\}/gi, domainClean);
  filename = filename.replace(/\{alt\}/gi, altClean);
  filename = filename.replace(/\{ext\}/gi, ext);

  // 2. Custom record column tokens
  if (context.record) {
    for (const [key, val] of Object.entries(context.record)) {
      if (key.startsWith('_')) continue;
      const token = new RegExp(`\\{${key}\\}`, 'gi');
      if (token.test(filename)) {
        const replacement = sanitizeFilenamePart(String(val ?? ''));
        filename = filename.replace(token, replacement);
      }
    }
  }

  // Clear unreplaced token brackets {unknown}
  filename = filename.replace(/\{[^}]+\}/g, '');

  // Split directory prefix if user template contains "/" (e.g. PageHarvest/{domain}/{index}.{ext})
  const segments = filename.split('/').map((seg) => sanitizeFilenamePart(seg)).filter(Boolean);
  let finalPath = segments.join('/');

  if (!finalPath) {
    finalPath = `image_${indexStr}.${ext}`;
  } else if (!finalPath.toLowerCase().endsWith(`.${ext}`)) {
    finalPath = `${finalPath}.${ext}`;
  }

  return finalPath;
}

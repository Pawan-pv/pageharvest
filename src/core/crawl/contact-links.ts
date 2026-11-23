/**
 * Pure-TypeScript contact and company subpage discovery.
 * Designed to work inside Chrome MV3 service workers with zero DOM dependencies.
 */

const HIGH_SIGNAL_PATTERNS = [
  /contact/i,
  /about/i,
  /team/i,
  /staff/i,
  /people/i,
  /leadership/i,
  /support/i,
  /imprint/i,
  /impressum/i,
  /legal/i,
  /connect/i,
  /press/i,
  /company/i,
  /help/i,
  /privacy/i,
  /terms/i,
];

const ASSET_EXTENSIONS = /\.(?:pdf|zip|tar|gz|rar|exe|dmg|apk|jpg|jpeg|png|gif|webp|svg|ico|bmp|tiff|css|js|map|json|xml|mp3|mp4|avi|mov|wmv|wav|ogg|woff|woff2|ttf|eot)(?:\?.*)?$/i;

export interface ContactLinkOptions {
  /** Maximum number of prioritized internal subpages to return per domain (default: 4, clamp 0–10). */
  maxSubpages?: number;
  /** Additional custom priority patterns */
  priorityPatterns?: RegExp[];
}

export interface DiscoveredSubpage {
  url: string;
  score: number;
  anchorText?: string;
}

/**
 * Extracts candidate internal links from raw HTML, ranking high-signal subpages (contact, about, etc.) first.
 */
export function extractContactLinks(
  html: string,
  baseUrl: string,
  options: ContactLinkOptions = {}
): string[] {
  const maxSubpages = Math.max(0, Math.min(10, options.maxSubpages ?? 4));
  if (maxSubpages === 0) return [];

  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return [];
  }

  const patterns = [...(options.priorityPatterns ?? []), ...HIGH_SIGNAL_PATTERNS];
  const candidates = new Map<string, number>();

  // Match href attributes: href="..." or href='...'
  const hrefRegex = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>(.*?)<\/a>/gis;
  let match: RegExpExecArray | null;

  while ((match = hrefRegex.exec(html)) !== null) {
    const rawHref = (match[1] || match[2] || match[3] || '').trim();
    const anchorInner = (match[4] || '').replace(/<[^>]+>/g, ' ').trim();

    if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:')) {
      continue;
    }

    if (ASSET_EXTENSIONS.test(rawHref)) {
      continue;
    }

    let resolvedUrl: string;
    try {
      resolvedUrl = new URL(rawHref, baseUrl).href;
    } catch {
      continue;
    }

    let parsed: URL;
    try {
      parsed = new URL(resolvedUrl);
    } catch {
      continue;
    }

    // Must be same origin
    if (parsed.origin !== origin) {
      continue;
    }

    // Clean hash & normalized path
    parsed.hash = '';
    const cleanUrl = parsed.href;

    // Don't link back to the exact current page
    let currentClean = baseUrl;
    try {
      const cur = new URL(baseUrl);
      cur.hash = '';
      currentClean = cur.href;
    } catch {
      // keep as is
    }

    if (cleanUrl === currentClean) {
      continue;
    }

    const testTarget = `${parsed.pathname} ${parsed.search} ${anchorInner}`;
    let score = 0;

    for (let i = 0; i < patterns.length; i++) {
      if (patterns[i].test(testTarget)) {
        // Earlier patterns receive slightly higher score weight
        score += Math.max(1, 10 - i);
      }
    }

    if (score > 0) {
      const existing = candidates.get(cleanUrl) ?? 0;
      if (score > existing) {
        candidates.set(cleanUrl, score);
      }
    }
  }

  // Sort by score descending and return up to maxSubpages
  return Array.from(candidates.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxSubpages)
    .map(([url]) => url);
}

/**
 * Pure-TypeScript Email Extractor with robust de-obfuscation and false-positive filtering.
 * Safe for execution in Chrome MV3 service workers and web page contexts.
 */

export type FoundVia = 'mailto' | 'text' | 'obfuscated';

export interface ExtractedEmail {
  email: string;
  emailDomain: string;
  sourceUrl: string;
  originUrl: string;
  pageTitle?: string;
  foundVia: FoundVia;
  depth: number;
}

const INVALID_DOMAIN_SUFFIXES = [
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.svg',
  '.gif',
  '.ico',
  '.bmp',
  '.tiff',
  '.css',
  '.js',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.mp4',
  '.zip',
];

const FILTERED_DOMAINS = new Set([
  'example.com',
  'example.org',
  'example.net',
  'domain.com',
  'yourdomain.com',
  'yoursite.com',
  'email.com',
  'test.com',
  'sample.com',
  'sentry.io',
  'wixpress.com',
  'schema.org',
  'github.com',
]);

const STANDARD_EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

// Obfuscated patterns like "name [at] domain [dot] com" or "name (at) domain.com"
const OBFUSCATED_AT_REGEX = /\b([A-Za-z0-9._%+-]+)\s*(?:\[at\]|\(at\)|\bat\b|&#64;|&#x40;|&commat;)\s*([A-Za-z0-9.-]+)\s*(?:\[dot\]|\(dot\)|\bdot\b|\.)\s*([A-Za-z]{2,})\b/gi;

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#64;/gi, '@')
    .replace(/&#x40;/gi, '@')
    .replace(/&commat;/gi, '@')
    .replace(/&#46;/gi, '.')
    .replace(/&#x2e;/gi, '.')
    .replace(/&period;/gi, '.');
}

/**
 * Validates whether an email string is clean and genuine.
 */
export function isValidEmail(email: string): boolean {
  if (!email || email.length > 254 || email.length < 5) return false;
  const parts = email.toLowerCase().split('@');
  if (parts.length !== 2) return false;

  const [local, domain] = parts;
  if (!local || !domain) return false;
  if (local.length > 64) return false;

  // Ignore git@... or asset indicators
  if (local === 'git') return false;

  for (const ext of INVALID_DOMAIN_SUFFIXES) {
    if (domain.endsWith(ext)) return false;
  }

  // Reject placeholder domains
  if (FILTERED_DOMAINS.has(domain)) return false;

  // Domain must contain a period and valid TLD
  const domainParts = domain.split('.');
  if (domainParts.length < 2) return false;
  const tld = domainParts[domainParts.length - 1];
  if (!tld || tld.length < 2 || !/^[a-z]+$/i.test(tld)) return false;

  return true;
}

/**
 * Extracts all unique emails found in an HTML document or raw text.
 */
export function extractEmailsFromHtml(
  html: string,
  sourceUrl: string,
  originUrl: string,
  depth = 0,
  pageTitle = ''
): ExtractedEmail[] {
  const seen = new Map<string, ExtractedEmail>();

  const addEmail = (raw: string, foundVia: FoundVia) => {
    let cleaned = raw.toLowerCase().trim();
    // Strip trailing punctuation like '.', ';', ','
    cleaned = cleaned.replace(/[.,;:]+$/, '');

    if (!isValidEmail(cleaned)) return;

    if (!seen.has(cleaned)) {
      const emailDomain = cleaned.split('@')[1] || '';
      seen.set(cleaned, {
        email: cleaned,
        emailDomain,
        sourceUrl,
        originUrl,
        pageTitle: pageTitle || undefined,
        foundVia,
        depth,
      });
    }
  };

  // 1. mailto: links (highest reliability)
  const mailtoRegex = /href\s*=\s*["']mailto:([^"'?#\s>]+)(?:\?[^"'>]*)?["']/gi;
  let match: RegExpExecArray | null;
  while ((match = mailtoRegex.exec(html)) !== null) {
    try {
      const decoded = decodeURIComponent(match[1]);
      addEmail(decoded, 'mailto');
    } catch {
      addEmail(match[1], 'mailto');
    }
  }

  // 2. Decode common HTML entities in text for standard & obfuscated scanning
  const decodedHtml = decodeHtmlEntities(html);

  // 3. Obfuscated matches like "hello [at] company [dot] com"
  while ((match = OBFUSCATED_AT_REGEX.exec(decodedHtml)) !== null) {
    const constructed = `${match[1]}@${match[2]}.${match[3]}`;
    addEmail(constructed, 'obfuscated');
  }

  // 4. Plain text regex scan across the whole document
  while ((match = STANDARD_EMAIL_REGEX.exec(decodedHtml)) !== null) {
    addEmail(match[0], 'text');
  }

  return Array.from(seen.values());
}

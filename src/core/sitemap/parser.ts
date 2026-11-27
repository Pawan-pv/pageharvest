import type { SitemapEntry } from './types';

export interface ParsedSitemap {
  type: 'index' | 'urlset';
  childSitemaps: string[];
  urls: SitemapEntry[];
}

function unescapeXml(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractTagContent(xml: string, tagName: string): string | undefined {
  // Matches <(optional-namespace:)tagName(?: [^>]*)?>content</(?:optional-namespace:)tagName>
  const regex = new RegExp(`<(?:[\\w-]+:)?${tagName}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${tagName}>`, 'i');
  const match = xml.match(regex);
  if (!match) return undefined;

  let content = match[1].trim();
  // Strip CDATA wrapper if present: <![CDATA[...]]>
  const cdataMatch = content.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i);
  if (cdataMatch) {
    content = cdataMatch[1].trim();
  } else {
    content = unescapeXml(content);
  }
  return content;
}

/**
 * Pure-TypeScript XML parser for sitemaps and sitemap indexes.
 * Does not depend on DOMParser, so it is 100% safe to run in MV3 background service workers.
 */
export function parseSitemapXml(xml: string): ParsedSitemap {
  const childSitemaps: string[] = [];
  const urls: SitemapEntry[] = [];

  // Check if this is a sitemap index (contains <sitemap> blocks)
  const sitemapBlockRegex = /<(?:[\w-]+:)?sitemap(?:\s+[^>]*)?>([\s\S]*?)<\/(?:[\w-]+:)?sitemap>/gi;
  let sitemapMatch: RegExpExecArray | null;
  while ((sitemapMatch = sitemapBlockRegex.exec(xml)) !== null) {
    const block = sitemapMatch[1];
    const loc = extractTagContent(block, 'loc');
    if (loc && loc.startsWith('http')) {
      childSitemaps.push(loc);
    }
  }

  if (childSitemaps.length > 0) {
    return {
      type: 'index',
      childSitemaps,
      urls: [],
    };
  }

  // Parse <url> blocks
  const urlBlockRegex = /<(?:[\w-]+:)?url(?:\s+[^>]*)?>([\s\S]*?)<\/(?:[\w-]+:)?url>/gi;
  let urlMatch: RegExpExecArray | null;
  while ((urlMatch = urlBlockRegex.exec(xml)) !== null) {
    const block = urlMatch[1];
    const loc = extractTagContent(block, 'loc');
    if (loc && loc.startsWith('http')) {
      const lastmod = extractTagContent(block, 'lastmod');
      const changefreq = extractTagContent(block, 'changefreq');
      const priority = extractTagContent(block, 'priority');

      urls.push({
        loc,
        ...(lastmod ? { lastmod } : {}),
        ...(changefreq ? { changefreq } : {}),
        ...(priority ? { priority } : {}),
      });
    }
  }

  return {
    type: 'urlset',
    childSitemaps: [],
    urls,
  };
}

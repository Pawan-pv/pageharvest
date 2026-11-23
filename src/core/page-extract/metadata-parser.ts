import type { PageMetadata } from './types';

function extractMetaContent(html: string, nameOrProperty: string): string {
  // Matches <meta (name|property)="nameOrProperty" content="..."> and <meta content="..." (name|property)="nameOrProperty">
  const p1 = new RegExp(`<meta\\s+[^>]*(?:name|property)=["']${nameOrProperty}["'][^>]*content=["']([\\s\\S]*?)["']`, 'i');
  const m1 = html.match(p1);
  if (m1) return m1[1].trim();

  const p2 = new RegExp(`<meta\\s+[^>]*content=["']([\\s\\S]*?)["'][^>]*(?:name|property)=["']${nameOrProperty}["']`, 'i');
  const m2 = html.match(p2);
  if (m2) return m2[1].trim();

  return '';
}

function extractTitle(html: string): string {
  const match = html.match(/<title(?:\s+[^>]*)?>([\s\S]*?)<\/title>/i);
  return match ? match[1].trim() : '';
}

function extractCanonical(html: string): string {
  const match = html.match(/<link\s+[^>]*rel=["']canonical["'][^>]*href=["']([\s\S]*?)["']/i);
  if (match) return match[1].trim();
  const matchReverse = html.match(/<link\s+[^>]*href=["']([\s\S]*?)["'][^>]*rel=["']canonical["']/i);
  return matchReverse ? matchReverse[1].trim() : '';
}

function extractLanguage(html: string): string {
  const match = html.match(/<html\s+[^>]*lang=["']([\s\S]*?)["']/i);
  return match ? match[1].trim() : '';
}

/**
 * Pure-TypeScript HTML metadata extractor. Runs in background service worker without DOMParser.
 */
export function parsePageMetadata(html: string, url: string): PageMetadata {
  return {
    sourceUrl: url,
    title: extractTitle(html),
    description: extractMetaContent(html, 'description'),
    canonical: extractCanonical(html),
    ogTitle: extractMetaContent(html, 'og:title'),
    ogDescription: extractMetaContent(html, 'og:description'),
    ogImage: extractMetaContent(html, 'og:image'),
    author: extractMetaContent(html, 'author'),
    publishedTime:
      extractMetaContent(html, 'article:published_time') ||
      extractMetaContent(html, 'og:article:published_time') ||
      extractMetaContent(html, 'publication_date'),
    language: extractLanguage(html),
  };
}

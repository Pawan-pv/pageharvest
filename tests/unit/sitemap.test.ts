import { describe, it, expect, vi } from 'vitest';
import { parseSitemapXml } from '@/core/sitemap/parser';
import { discoverSitemaps } from '@/core/sitemap/discovery';
import { crawlSitemaps } from '@/core/sitemap/crawler';
import { decompressGzip } from '@/core/sitemap/gzip';

describe('Sitemap XML Parser', () => {
  it('parses basic urlset with loc, lastmod, changefreq, and priority', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url>
        <loc>https://example.com/page-1</loc>
        <lastmod>2026-11-20</lastmod>
        <changefreq>daily</changefreq>
        <priority>0.8</priority>
      </url>
      <url>
        <loc>https://example.com/page-2</loc>
      </url>
    </urlset>`;

    const result = parseSitemapXml(xml);
    expect(result.type).toBe('urlset');
    expect(result.childSitemaps).toHaveLength(0);
    expect(result.urls).toEqual([
      {
        loc: 'https://example.com/page-1',
        lastmod: '2026-11-20',
        changefreq: 'daily',
        priority: '0.8',
      },
      {
        loc: 'https://example.com/page-2',
      },
    ]);
  });

  it('handles namespaces, CDATA and XML unescaping', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
      <url>
        <loc><![CDATA[https://example.com/search?q=shoes&category=sneakers]]></loc>
        <lastmod>2026-10-01</lastmod>
        <image:image>
          <image:loc>https://example.com/images/shoe.jpg</image:loc>
        </image:image>
      </url>
      <url>
        <loc>https://example.com/item?foo=1&amp;bar=2</loc>
      </url>
    </urlset>`;

    const result = parseSitemapXml(xml);
    expect(result.type).toBe('urlset');
    expect(result.urls[0].loc).toBe('https://example.com/search?q=shoes&category=sneakers');
    expect(result.urls[1].loc).toBe('https://example.com/item?foo=1&bar=2');
  });

  it('parses sitemap index containing child sitemaps', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <sitemap>
        <loc>https://example.com/sitemap-products.xml</loc>
        <lastmod>2026-11-01</lastmod>
      </sitemap>
      <sitemap>
        <loc>https://example.com/sitemap-blogs.xml</loc>
      </sitemap>
    </sitemapindex>`;

    const result = parseSitemapXml(xml);
    expect(result.type).toBe('index');
    expect(result.childSitemaps).toEqual([
      'https://example.com/sitemap-products.xml',
      'https://example.com/sitemap-blogs.xml',
    ]);
    expect(result.urls).toHaveLength(0);
  });
});

describe('Sitemap GZIP decompression', () => {
  it('decompresses gzip data using DecompressionStream', async () => {
    const rawString = '<urlset><url><loc>https://example.com/gz-page</loc></url></urlset>';
    // Compress with CompressionStream
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    writer.write(new TextEncoder().encode(rawString));
    writer.close();
    const compressedBuffer = await new Response(cs.readable).arrayBuffer();

    const decompressed = await decompressGzip(compressedBuffer);
    expect(decompressed).toBe(rawString);
  });
});

describe('Sitemap Discovery', () => {
  it('returns direct XML URL without fetching robots.txt', async () => {
    const fetchFn = vi.fn();
    const result = await discoverSitemaps('https://example.com/custom-sitemap.xml', fetchFn);
    expect(result).toEqual(['https://example.com/custom-sitemap.xml']);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('extracts Sitemap directives from robots.txt', async () => {
    const robotsTxt = `
      User-agent: *
      Disallow: /admin
      Sitemap: https://example.com/sitemap_index.xml
      Sitemap: https://example.com/sitemap-news.xml
    `;
    const fetchFn = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/robots.txt')) {
        return new Response(robotsTxt, { status: 200 });
      }
      return new Response('', { status: 404 });
    });

    const result = await discoverSitemaps('https://example.com', fetchFn);
    expect(result).toEqual([
      'https://example.com/sitemap_index.xml',
      'https://example.com/sitemap-news.xml',
    ]);
  });
});

describe('Sitemap Crawler', () => {
  it('crawls index and recurses into child sitemaps with cycle prevention', async () => {
    const sitemapIndex = `
      <sitemapindex>
        <sitemap><loc>https://example.com/child-1.xml</loc></sitemap>
        <sitemap><loc>https://example.com/index.xml</loc></sitemap>
      </sitemapindex>
    `;
    const child1 = `
      <urlset>
        <url><loc>https://example.com/p1</loc></url>
        <url><loc>https://example.com/p2</loc></url>
      </urlset>
    `;

    const fetchFn = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('robots.txt')) {
        return new Response('Sitemap: https://example.com/index.xml', { status: 200 });
      }
      if (url === 'https://example.com/index.xml') {
        return new Response(sitemapIndex, { status: 200 });
      }
      if (url === 'https://example.com/child-1.xml') {
        return new Response(child1, { status: 200 });
      }
      return new Response('', { status: 404 });
    });

    const progressUpdates: number[] = [];
    const result = await crawlSitemaps({
      startUrl: 'https://example.com',
      fetchFn,
      minDelayMs: 0,
      onProgress: (p) => progressUpdates.push(p.urlsFound),
    });

    expect(result.urls).toHaveLength(2);
    expect(result.urls.map((u) => u.loc)).toEqual([
      'https://example.com/p1',
      'https://example.com/p2',
    ]);
    expect(result.sitemaps).toContain('https://example.com/index.xml');
    expect(result.sitemaps).toContain('https://example.com/child-1.xml');
    expect(progressUpdates.length).toBeGreaterThan(0);
  });

  it('respects hard cap on maxUrls', async () => {
    const urlset = `
      <urlset>
        <url><loc>https://example.com/1</loc></url>
        <url><loc>https://example.com/2</loc></url>
        <url><loc>https://example.com/3</loc></url>
        <url><loc>https://example.com/4</loc></url>
      </urlset>
    `;

    const fetchFn = vi.fn().mockImplementation(async () => {
      return new Response(urlset, { status: 200 });
    });

    const result = await crawlSitemaps({
      startUrl: 'https://example.com/sitemap.xml',
      maxUrls: 2,
      minDelayMs: 0,
      fetchFn,
    });

    expect(result.urls).toHaveLength(2);
  });

  it('aborts crawl cleanly when signal fires', async () => {
    const controller = new AbortController();
    const fetchFn = vi.fn().mockImplementation(async () => {
      controller.abort();
      return new Response('<urlset><url><loc>https://example.com/1</loc></url></urlset>', { status: 200 });
    });

    const result = await crawlSitemaps({
      startUrl: 'https://example.com/sitemap.xml',
      signal: controller.signal,
      minDelayMs: 0,
      fetchFn,
    });

    expect(result.urls).toBeDefined();
  });
});

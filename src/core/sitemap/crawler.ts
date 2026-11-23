import type { SitemapCrawlerOptions, SitemapEntry, SitemapScanResult } from './types';
import { discoverSitemaps } from './discovery';
import { parseSitemapXml } from './parser';
import { decompressGzip } from './gzip';

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Sitemap exploration cancelled.'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Sitemap exploration cancelled.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Crawls sitemaps starting from a site URL or sitemap URL, recursively resolving
 * sitemapindex trees up to maxDepth with cycle detection and rate limiting.
 */
export async function crawlSitemaps(options: SitemapCrawlerOptions): Promise<SitemapScanResult> {
  const maxDepth = options.maxDepth ?? 5;
  const maxUrls = options.maxUrls ?? 50_000;
  const minDelayMs = Math.max(options.minDelayMs ?? 1000, 0);
  const fetchFn = options.fetchFn ?? fetch;
  const signal = options.signal;

  const initialSitemaps = await discoverSitemaps(options.startUrl, fetchFn);

  const visitedSitemaps = new Set<string>();
  const discoveredUrls: SitemapEntry[] = [];
  const errors: string[] = [];
  const sitemapQueue: { url: string; depth: number }[] = initialSitemaps.map((u) => ({
    url: u,
    depth: 1,
  }));

  while (sitemapQueue.length > 0) {
    if (signal?.aborted) break;
    if (discoveredUrls.length >= maxUrls) break;

    const current = sitemapQueue.shift()!;
    if (visitedSitemaps.has(current.url)) continue;
    if (current.depth > maxDepth) continue;

    visitedSitemaps.add(current.url);

    options.onProgress?.({
      sitemapsScanned: visitedSitemaps.size,
      urlsFound: discoveredUrls.length,
      currentSitemap: current.url,
    });

    try {
      const response = await fetchFn(current.url, { signal });
      if (!response.ok) {
        errors.push(`Failed to fetch ${current.url}: HTTP ${response.status}`);
        continue;
      }

      let xml: string;
      const contentType = response.headers.get('content-type') || '';
      const isGzip = current.url.endsWith('.gz') || contentType.includes('gzip');

      if (isGzip) {
        const buffer = await response.arrayBuffer();
        xml = await decompressGzip(buffer);
      } else {
        xml = await response.text();
      }

      const parsed = parseSitemapXml(xml);

      if (parsed.type === 'index') {
        for (const childUrl of parsed.childSitemaps) {
          if (!visitedSitemaps.has(childUrl) && current.depth < maxDepth) {
            sitemapQueue.push({ url: childUrl, depth: current.depth + 1 });
          }
        }
      } else {
        for (const entry of parsed.urls) {
          if (discoveredUrls.length >= maxUrls) break;
          discoveredUrls.push(entry);
        }
      }

      options.onProgress?.({
        sitemapsScanned: visitedSitemaps.size,
        urlsFound: discoveredUrls.length,
        currentSitemap: current.url,
      });
    } catch (err: unknown) {
      if (signal?.aborted) break;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Error parsing ${current.url}: ${msg}`);
    }

    if (sitemapQueue.length > 0 && minDelayMs > 0 && !signal?.aborted) {
      await sleep(minDelayMs, signal);
    }
  }

  return {
    urls: discoveredUrls.slice(0, maxUrls),
    sitemaps: Array.from(visitedSitemaps),
    errors,
  };
}

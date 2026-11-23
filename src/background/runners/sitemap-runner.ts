import { crawlSitemaps } from '@/core/sitemap/crawler';
import type { SitemapCrawlerOptions, SitemapScanResult } from '@/core/sitemap/types';

export async function runSitemapScan(options: SitemapCrawlerOptions): Promise<SitemapScanResult> {
  return await crawlSitemaps(options);
}

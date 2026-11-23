export interface SitemapEntry {
  loc: string;
  lastmod?: string;
  changefreq?: string;
  priority?: string;
}

export interface SitemapProgress {
  sitemapsScanned: number;
  urlsFound: number;
  currentSitemap?: string;
}

export interface SitemapScanResult {
  urls: SitemapEntry[];
  sitemaps: string[];
  errors: string[];
}

export interface SitemapCrawlerOptions {
  startUrl: string;
  maxDepth?: number;
  maxUrls?: number;
  minDelayMs?: number;
  signal?: AbortSignal;
  onProgress?: (progress: SitemapProgress) => void;
  fetchFn?: typeof fetch;
}

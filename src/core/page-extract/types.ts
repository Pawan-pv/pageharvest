import type { ExtractedRecord } from '@/types';
import type { ToolJobProgress } from '@/shared/contracts/tool-job';

export interface PageMetadata {
  sourceUrl: string;
  title: string;
  description: string;
  canonical: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  author: string;
  publishedTime: string;
  language: string;
}

export interface JsonLdData {
  schemaType: string;
  name: string;
  price: string;
  priceCurrency: string;
  availability: string;
  sku: string;
  brand: string;
  ratingValue: string;
  reviewCount: string;
  schemaImage: string;
}

export interface CustomCssField {
  name: string;
  selector: string;
  attribute: 'text' | 'href' | 'src' | 'content';
}

export interface PageActionsConfig {
  waitMs?: number;
  scrollToBottom?: boolean;
  clickSelector?: string;
}

export interface PageExtractorOptions {
  urls: string[];
  extractMetadata?: boolean;
  extractJsonLd?: boolean;
  customFields?: CustomCssField[];
  pageActions?: PageActionsConfig;
  mode?: 'fast_fetch' | 'browser_tab';
  concurrency?: number;
  minDelayMs?: number;
  datasetId?: string;
  onProgress?: (progress: ToolJobProgress) => void;
  onRowExtracted?: (row: ExtractedRecord) => void;
}

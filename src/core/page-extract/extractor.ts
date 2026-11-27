import { parsePageMetadata } from './metadata-parser';
import { parseJsonLd } from './jsonld-parser';
import type { PageExtractorOptions } from './types';
import type { ExtractedRecord } from '@/types';

/**
 * Combines parsed metadata, JSON-LD, and custom fields into a flat ExtractedRecord.
 */
export function buildPageRecord(
  html: string,
  url: string,
  options: Pick<PageExtractorOptions, 'extractMetadata' | 'extractJsonLd'>
): ExtractedRecord {
  const extractMetadata = options.extractMetadata ?? true;
  const extractJsonLd = options.extractJsonLd ?? true;

  const record: ExtractedRecord = {
    _id: `page_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    _page: 1,
    _extractedAt: Date.now(),
    URL: url,
  };

  if (extractMetadata) {
    const meta = parsePageMetadata(html, url);
    record['Title'] = meta.title;
    record['Description'] = meta.description;
    record['Canonical'] = meta.canonical;
    record['OG Title'] = meta.ogTitle;
    record['OG Description'] = meta.ogDescription;
    record['OG Image'] = meta.ogImage;
    record['Author'] = meta.author;
    record['Published Time'] = meta.publishedTime;
    record['Language'] = meta.language;
  }

  if (extractJsonLd) {
    const jsonLd = parseJsonLd(html);
    if (jsonLd.schemaType) record['Schema Type'] = jsonLd.schemaType;
    if (jsonLd.name) record['Schema Name'] = jsonLd.name;
    if (jsonLd.price) record['Price'] = jsonLd.price;
    if (jsonLd.priceCurrency) record['Currency'] = jsonLd.priceCurrency;
    if (jsonLd.availability) record['Availability'] = jsonLd.availability;
    if (jsonLd.sku) record['SKU'] = jsonLd.sku;
    if (jsonLd.brand) record['Brand'] = jsonLd.brand;
    if (jsonLd.ratingValue) record['Rating'] = jsonLd.ratingValue;
    if (jsonLd.reviewCount) record['Review Count'] = jsonLd.reviewCount;
    if (jsonLd.schemaImage) record['Schema Image'] = jsonLd.schemaImage;
  }

  return record;
}

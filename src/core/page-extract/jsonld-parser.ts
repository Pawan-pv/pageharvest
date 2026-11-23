import type { JsonLdData } from './types';

function stringValue(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'number') return String(val);
  if (typeof val === 'object' && 'name' in (val as Record<string, unknown>)) {
    return stringValue((val as Record<string, unknown>).name);
  }
  return '';
}

interface RawEntity {
  '@type'?: string | string[];
  name?: unknown;
  headline?: unknown;
  title?: unknown;
  price?: unknown;
  priceCurrency?: unknown;
  availability?: unknown;
  sku?: unknown;
  brand?: unknown;
  aggregateRating?: {
    ratingValue?: unknown;
    reviewCount?: unknown;
  };
  offers?: unknown;
  image?: unknown;
  '@graph'?: RawEntity[];
  [key: string]: unknown;
}

function normalizeEntities(jsonObj: unknown): RawEntity[] {
  if (!jsonObj || typeof jsonObj !== 'object') return [];
  if (Array.isArray(jsonObj)) {
    return jsonObj.flatMap(normalizeEntities);
  }

  const obj = jsonObj as RawEntity;
  const list: RawEntity[] = [];

  if (Array.isArray(obj['@graph'])) {
    list.push(...obj['@graph'].flatMap(normalizeEntities));
  } else {
    list.push(obj);
  }

  return list;
}

/**
 * Parses all <script type="application/ld+json"> blocks and flattens primary schema entities
 * (like Product, Article, Recipe, Organization, etc.) into clean structured fields.
 */
export function parseJsonLd(html: string): JsonLdData {
  const result: JsonLdData = {
    schemaType: '',
    name: '',
    price: '',
    priceCurrency: '',
    availability: '',
    sku: '',
    brand: '',
    ratingValue: '',
    reviewCount: '',
    schemaImage: '',
  };

  const scriptRegex = /<script\s+[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  const allEntities: RawEntity[] = [];

  while ((match = scriptRegex.exec(html)) !== null) {
    try {
      const rawText = match[1].trim();
      if (!rawText) continue;
      const parsed = JSON.parse(rawText);
      allEntities.push(...normalizeEntities(parsed));
    } catch {
      // Ignore invalid JSON-LD blocks
    }
  }

  if (allEntities.length === 0) return result;

  // Prioritize Product, then Article / NewsArticle / BlogPosting, then others
  const productEntity = allEntities.find((e) => {
    const t = Array.isArray(e['@type']) ? e['@type'].join(' ') : e['@type'] ?? '';
    return /Product/i.test(t);
  });

  const articleEntity = allEntities.find((e) => {
    const t = Array.isArray(e['@type']) ? e['@type'].join(' ') : e['@type'] ?? '';
    return /Article|NewsArticle|BlogPosting|Recipe/i.test(t);
  });

  const primary = productEntity || articleEntity || allEntities[0];

  const typeVal = Array.isArray(primary['@type']) ? primary['@type'][0] : primary['@type'];
  result.schemaType = stringValue(typeVal);
  result.name = stringValue(primary.name || primary.headline || primary.title);
  result.sku = stringValue(primary.sku);
  result.brand = stringValue(primary.brand);

  // Offers & Pricing
  let offers = primary.offers;
  if (Array.isArray(offers)) {
    offers = offers[0];
  }
  if (offers && typeof offers === 'object') {
    const off = offers as Record<string, unknown>;
    result.price = stringValue(off.price);
    result.priceCurrency = stringValue(off.priceCurrency);
    result.availability = stringValue(off.availability);
  } else {
    result.price = stringValue(primary.price);
    result.priceCurrency = stringValue(primary.priceCurrency);
    result.availability = stringValue(primary.availability);
  }

  // Aggregate Rating
  if (primary.aggregateRating && typeof primary.aggregateRating === 'object') {
    result.ratingValue = stringValue(primary.aggregateRating.ratingValue);
    result.reviewCount = stringValue(primary.aggregateRating.reviewCount);
  }

  // Image
  if (typeof primary.image === 'string') {
    result.schemaImage = primary.image.trim();
  } else if (Array.isArray(primary.image) && primary.image.length > 0) {
    result.schemaImage = stringValue(primary.image[0]);
  } else if (typeof primary.image === 'object' && primary.image !== null) {
    result.schemaImage = stringValue((primary.image as Record<string, unknown>).url);
  }

  return result;
}

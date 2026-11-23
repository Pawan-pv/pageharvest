export interface ShopifyVariant {
  id: number;
  product_id?: number;
  title: string;
  price: string;
  sku: string | null;
  position: number;
  compare_at_price: string | null;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  grams: number;
  image_id: number | null;
  available?: boolean;
}

export interface ShopifyImage {
  id: number;
  src: string;
  position: number;
  alt?: string | null;
}

export interface ShopifyOption {
  name: string;
  position: number;
  values: string[];
}

export interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  body_html: string | null;
  vendor: string;
  product_type: string;
  created_at: string;
  published_at: string | null;
  tags: string | string[];
  variants: ShopifyVariant[];
  images: ShopifyImage[];
  options: ShopifyOption[];
}

export interface ShopifyCollection {
  id: number;
  handle: string;
  title: string;
  products_count?: number;
}

export type ShopifyGranularity = 'variant' | 'product';

export interface ShopifyProgress {
  pagesFetched: number;
  productsFound: number;
  variantsFound: number;
  status: 'running' | 'paused' | 'rate_limited' | 'completed' | 'cancelled' | 'error';
  rateLimitWaitMs?: number;
}

export interface ShopifyExtractionOptions {
  storeUrl: string;
  collectionHandle?: string;
  granularity?: ShopifyGranularity;
  maxPages?: number;
  minDelayMs?: number; // >= 1000 ms (ADR-046)
  signal?: AbortSignal;
  onProgress?: (progress: ShopifyProgress) => void;
  fetchFn?: typeof fetch;
}

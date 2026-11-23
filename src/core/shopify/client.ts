import type {
  ShopifyCollection,
  ShopifyExtractionOptions,
  ShopifyProduct,
} from './types';
import type { ExtractedRecord } from '@/types';

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Shopify extraction cancelled.'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Shopify extraction cancelled.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function cleanTags(tags: string | string[] | undefined): string {
  if (!tags) return '';
  if (Array.isArray(tags)) return tags.join(', ');
  return String(tags).trim();
}

export async function fetchShopifyCollections(
  storeUrl: string,
  fetchFn: typeof fetch = fetch
): Promise<ShopifyCollection[]> {
  try {
    const origin = new URL(storeUrl.startsWith('http') ? storeUrl : `https://${storeUrl}`).origin;
    const url = `${origin}/collections.json?limit=250`;
    const response = await fetchFn(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) return [];
    const data = await response.json();
    if (data && Array.isArray(data.collections)) {
      return (data.collections as ShopifyCollection[]).map((c) => ({
        id: c.id,
        handle: c.handle,
        title: c.title,
        products_count: c.products_count,
      }));
    }
  } catch {
    // Ignore
  }
  return [];
}

/**
 * Transforms Shopify products into rows according to the chosen granularity.
 */
export function flattenShopifyProducts(
  products: ShopifyProduct[],
  storeOrigin: string,
  granularity: 'variant' | 'product' = 'variant'
): ExtractedRecord[] {
  const records: ExtractedRecord[] = [];

  for (const product of products) {
    const productUrl = `${storeOrigin}/products/${product.handle}`;
    const mainImage = product.images?.[0]?.src ?? '';
    const opt1Name = product.options?.[0]?.name ?? 'Title';
    const opt2Name = product.options?.[1]?.name ?? '';
    const opt3Name = product.options?.[2]?.name ?? '';
    const tags = cleanTags(product.tags);

    if (granularity === 'product') {
      const minPrice = product.variants?.reduce(
        (min, v) => (parseFloat(v.price) < parseFloat(min) ? v.price : min),
        product.variants[0]?.price ?? '0'
      );

      records.push({
        _id: `prod_${product.id}_${Date.now()}`,
        _page: 1,
        _extractedAt: Date.now(),
        Handle: product.handle,
        Title: product.title,
        'Body (HTML)': product.body_html ?? '',
        Vendor: product.vendor ?? '',
        Type: product.product_type ?? '',
        Tags: tags,
        Published: product.published_at ? 'true' : 'false',
        'Option1 Name': opt1Name,
        'Option1 Value': product.variants?.[0]?.option1 ?? 'Default Title',
        'Option2 Name': opt2Name,
        'Option2 Value': product.variants?.[0]?.option2 ?? '',
        'Option3 Name': opt3Name,
        'Option3 Value': product.variants?.[0]?.option3 ?? '',
        'Variant SKU': product.variants?.[0]?.sku ?? '',
        'Variant Grams': product.variants?.[0]?.grams ?? 0,
        'Variant Price': minPrice,
        'Variant Compare At Price': product.variants?.[0]?.compare_at_price ?? '',
        'Variant Available': product.variants?.some((v) => v.available !== false) ? 'true' : 'false',
        'Image Src': mainImage,
        'Variant Image': '',
        'Product URL': productUrl,
      });
      continue;
    }

    // Default: One row per variant
    const variants = product.variants?.length > 0 ? product.variants : [{ id: 0, title: 'Default', price: '0', sku: '', position: 1, compare_at_price: null, option1: 'Default Title', option2: null, option3: null, grams: 0, image_id: null }];

    variants.forEach((v, index) => {
      // Find variant image
      let varImg = '';
      if (v.image_id && product.images) {
        const found = product.images.find((img) => img.id === v.image_id);
        if (found) varImg = found.src;
      }
      const imageSrc = index === 0 ? mainImage : varImg || (product.images?.[index]?.src ?? '');

      records.push({
        _id: `var_${product.id}_${v.id || index}_${Date.now()}`,
        _page: 1,
        _extractedAt: Date.now(),
        Handle: product.handle,
        Title: product.title,
        'Body (HTML)': product.body_html ?? '',
        Vendor: product.vendor ?? '',
        Type: product.product_type ?? '',
        Tags: tags,
        Published: product.published_at ? 'true' : 'false',
        'Option1 Name': opt1Name,
        'Option1 Value': v.option1 ?? '',
        'Option2 Name': opt2Name,
        'Option2 Value': v.option2 ?? '',
        'Option3 Name': opt3Name,
        'Option3 Value': v.option3 ?? '',
        'Variant SKU': v.sku ?? '',
        'Variant Grams': v.grams ?? 0,
        'Variant Price': v.price ?? '0',
        'Variant Compare At Price': v.compare_at_price ?? '',
        'Variant Available': v.available !== false ? 'true' : 'false',
        'Image Src': imageSrc,
        'Variant Image': varImg,
        'Product URL': productUrl,
      });
    });
  }

  return records;
}

export async function* paginateShopifyProducts(
  options: ShopifyExtractionOptions
): AsyncGenerator<ExtractedRecord[], void, unknown> {
  const origin = new URL(options.storeUrl.startsWith('http') ? options.storeUrl : `https://${options.storeUrl}`).origin;
  const granularity = options.granularity ?? 'variant';
  const minDelayMs = Math.max(options.minDelayMs ?? 1000, 1000);
  const maxPages = options.maxPages ?? 100;
  const fetchFn = options.fetchFn ?? fetch;
  const signal = options.signal;

  let page = 1;
  let totalProducts = 0;
  let totalVariants = 0;

  const basePath = options.collectionHandle
    ? `${origin}/collections/${encodeURIComponent(options.collectionHandle)}/products.json`
    : `${origin}/products.json`;

  while (page <= maxPages) {
    if (signal?.aborted) break;

    const pageUrl = `${basePath}?limit=250&page=${page}`;

    let response: Response;
    try {
      response = await fetchFn(pageUrl, {
        signal,
        headers: { Accept: 'application/json' },
      });
    } catch (err: unknown) {
      if (signal?.aborted) break;
      throw err;
    }

    // Handle 429 Too Many Requests
    if (response.status === 429) {
      const retryAfterSec = parseInt(response.headers.get('Retry-After') || '2', 10);
      const waitMs = Math.max(retryAfterSec * 1000, 2000);

      options.onProgress?.({
        pagesFetched: page - 1,
        productsFound: totalProducts,
        variantsFound: totalVariants,
        status: 'rate_limited',
        rateLimitWaitMs: waitMs,
      });

      await sleep(waitMs, signal);
      continue; // Retry same page
    }

    if (!response.ok) {
      if (response.status === 404) break; // Reached end
      throw new Error(`Shopify API answered HTTP ${response.status} on page ${page}`);
    }

    const data = await response.json();
    const products: ShopifyProduct[] = data?.products ?? [];
    if (products.length === 0) {
      break; // No more products
    }

    totalProducts += products.length;
    const batch = flattenShopifyProducts(products, origin, granularity);
    totalVariants += batch.length;

    options.onProgress?.({
      pagesFetched: page,
      productsFound: totalProducts,
      variantsFound: totalVariants,
      status: 'running',
    });

    yield batch;

    page++;
    if (minDelayMs > 0 && !signal?.aborted) {
      await sleep(minDelayMs, signal);
    }
  }

  options.onProgress?.({
    pagesFetched: page - 1,
    productsFound: totalProducts,
    variantsFound: totalVariants,
    status: signal?.aborted ? 'cancelled' : 'completed',
  });
}

import { paginateShopifyProducts } from '@/core/shopify/client';
import type { ShopifyExtractionOptions } from '@/core/shopify/types';
import { db as defaultDb, type PageHarvestDB } from '@/storage/db';
import { createDatasetBatchCommitter } from '@/background/tab-worker-pool';

export { paginateShopifyProducts };

export async function runShopifyExtraction(
  options: ShopifyExtractionOptions & { datasetId: string },
  dbInstance: PageHarvestDB = defaultDb
): Promise<void> {
  const committer = createDatasetBatchCommitter(dbInstance, options.datasetId);

  for await (const batch of paginateShopifyProducts(options)) {
    if (options.signal?.aborted) break;
    if (batch.length > 0) {
      await committer(options.storeUrl, batch);
    }
  }
}

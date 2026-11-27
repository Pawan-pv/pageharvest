import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  ExternalLink,
  Layers,
  Loader2,
  Play,
  ShoppingBag,
  StopCircle,
} from 'lucide-react';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { Input } from '@/components/common/Input';
import { Banner } from '@/components/common/Banner';
import { HarvestProgressStage, recordsToConveyorItems } from '@/components/shared/HarvestProgressStage';
import { fetchShopifyCollections } from '@/core/shopify/client';
import { paginateShopifyProducts } from '@/background/runners/shopify-runner';
import { detectShopifyStore } from '@/core/shopify/detector';
import type { ShopifyCollection, ShopifyGranularity, ShopifyProgress } from '@/core/shopify/types';
import { recordsToShopifyCsv } from '@/core/export/shopify-csv';
import { triggerDownload } from '@/platform/downloads';
import { openWorkbench } from '@/platform/workbench';
import { messagingService } from '@/services/messaging';
import type { ExtractedRecord, FieldDefinition } from '@/types';

export interface ShopifyExtractorViewProps {
  initialUrl?: string;
  onBack?: () => void;
  onOpenTable?: (datasetId: string) => void;
}

export const ShopifyExtractorView: React.FC<ShopifyExtractorViewProps> = ({
  initialUrl = '',
  onBack,
  onOpenTable,
}) => {
  const [storeUrl, setStoreUrl] = useState(() => {
    try {
      if (initialUrl && initialUrl.startsWith('http')) {
        return new URL(initialUrl).origin;
      }
    } catch {
      // Ignore
    }
    return initialUrl;
  });

  const [collections, setCollections] = useState<ShopifyCollection[]>([]);
  const [selectedCollection, setSelectedCollection] = useState('');
  const [granularity, setGranularity] = useState<ShopifyGranularity>('variant');
  const [isStoreVerified, setIsStoreVerified] = useState<boolean | null>(null);
  const [isCheckingStore, setIsCheckingStore] = useState(false);

  // Run state
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<ShopifyProgress | null>(null);
  const [extractedRecords, setExtractedRecords] = useState<ExtractedRecord[]>([]);
  const [createdDatasetId, setCreatedDatasetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Probe store on mount or url change
  useEffect(() => {
    let live = true;
    if (!storeUrl || !storeUrl.startsWith('http')) return;

    setIsCheckingStore(true);
    void detectShopifyStore(storeUrl).then((detected) => {
      if (!live) return;
      setIsStoreVerified(detected);
      setIsCheckingStore(false);
      if (detected) {
        void fetchShopifyCollections(storeUrl).then((cols) => {
          if (live) setCollections(cols);
        });
      }
    });

    return () => {
      live = false;
      abortControllerRef.current?.abort();
    };
  }, [storeUrl]);

  const handleStart = async () => {
    const trimmed = storeUrl.trim();
    if (!trimmed || isRunning) return;

    setError(null);
    setExtractedRecords([]);
    setCreatedDatasetId(null);
    setIsRunning(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const origin = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`).origin;
      const host = new URL(origin).hostname;
      const collName = selectedCollection
        ? collections.find((c) => c.handle === selectedCollection)?.title || selectedCollection
        : 'All Products';
      const datasetName = `Shopify Catalog - ${host} (${collName})`;

      const fields: FieldDefinition[] = [
        { id: 'f_handle', name: 'Handle', selector: 'Handle', extractor: 'text', transform: 'trim', required: true },
        { id: 'f_title', name: 'Title', selector: 'Title', extractor: 'text', transform: 'trim', required: true },
        { id: 'f_vendor', name: 'Vendor', selector: 'Vendor', extractor: 'text', transform: 'trim', required: false },
        { id: 'f_type', name: 'Type', selector: 'Type', extractor: 'text', transform: 'trim', required: false },
        { id: 'f_price', name: 'Variant Price', selector: 'Variant Price', extractor: 'text', transform: 'trim', required: false },
        { id: 'f_compare_price', name: 'Variant Compare At Price', selector: 'Variant Compare At Price', extractor: 'text', transform: 'trim', required: false },
        { id: 'f_opt1_name', name: 'Option1 Name', selector: 'Option1 Name', extractor: 'text', transform: 'trim', required: false },
        { id: 'f_opt1_val', name: 'Option1 Value', selector: 'Option1 Value', extractor: 'text', transform: 'trim', required: false },
        { id: 'f_opt2_name', name: 'Option2 Name', selector: 'Option2 Name', extractor: 'text', transform: 'trim', required: false },
        { id: 'f_opt2_val', name: 'Option2 Value', selector: 'Option2 Value', extractor: 'text', transform: 'trim', required: false },
        { id: 'f_sku', name: 'Variant SKU', selector: 'Variant SKU', extractor: 'text', transform: 'trim', required: false },
        { id: 'f_grams', name: 'Variant Grams', selector: 'Variant Grams', extractor: 'number', transform: 'trim', required: false },
        { id: 'f_avail', name: 'Variant Available', selector: 'Variant Available', extractor: 'text', transform: 'trim', required: false },
        { id: 'f_img', name: 'Image Src', selector: 'Image Src', extractor: 'text', transform: 'trim', required: false },
        { id: 'f_var_img', name: 'Variant Image', selector: 'Variant Image', extractor: 'text', transform: 'trim', required: false },
        { id: 'f_url', name: 'Product URL', selector: 'Product URL', extractor: 'text', transform: 'trim', required: false },
      ];

      // Create dataset first via background single-writer
      const dsId = await messagingService.createDataset(datasetName, origin, fields, []);
      setCreatedDatasetId(dsId);

      const allRecords: ExtractedRecord[] = [];

      for await (const batch of paginateShopifyProducts({
        storeUrl: origin,
        collectionHandle: selectedCollection || undefined,
        granularity,
        signal: controller.signal,
        onProgress: (p) => setProgress(p),
      })) {
        if (controller.signal.aborted) break;
        if (batch.length > 0) {
          allRecords.push(...batch);
          setExtractedRecords((prev) => [...prev, ...batch]);
          // Write batch through background single-writer
          await messagingService.applyDatasetEdit(dsId, allRecords, fields);
        }
      }
    } catch (err: unknown) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setIsRunning(false);
      abortControllerRef.current = null;
    }
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
    setIsRunning(false);
  };

  const handleExportShopifyCsv = async () => {
    if (extractedRecords.length === 0) return;
    try {
      const csv = recordsToShopifyCsv(extractedRecords, true);
      const host = new URL(storeUrl).hostname;
      const filename = `shopify-products-${host}.csv`;
      await triggerDownload({
        content: csv,
        filename,
        mimeType: 'text/csv',
      });
    } catch (err: unknown) {
      setError(`CSV export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleOpenTable = () => {
    if (createdDatasetId) {
      if (onOpenTable) onOpenTable(createdDatasetId);
      else void openWorkbench({ datasetId: createdDatasetId });
    }
  };

  return (
    <div className="flex flex-col gap-3.5 p-4 text-left font-sans">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-line/60 pb-3">
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-line bg-surface text-fg-muted hover:text-fg"
              aria-label="Back to tools"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </button>
          )}
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-tool-lime/25 bg-tool-lime/15 text-tool-lime"
          >
            <ShoppingBag className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-bold tracking-tight text-fg">Shopify Extractor</h2>
            <p className="text-2xs text-fg-subtle">Extract complete product catalogs with Shopify CSV parity</p>
          </div>
        </div>
      </div>

      {error && (
        <Banner tone="danger" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}

      {/* Store URL & Verification Card */}
      <Card className="flex flex-col gap-2.5 p-3">
        <label htmlFor="shopify-store-input" className="text-2xs font-bold uppercase tracking-wider text-fg-muted">
          Shopify Storefront URL
        </label>
        <div className="flex items-center gap-2">
          <Input
            id="shopify-store-input"
            value={storeUrl}
            onChange={(e) => setStoreUrl(e.target.value)}
            placeholder="https://example.myshopify.com or brand shop URL"
            disabled={isRunning}
          />
          {isCheckingStore && <Loader2 className="h-4 w-4 animate-spin text-tool-lime" />}
          {isStoreVerified === true && (
            <span className="flex items-center gap-1 text-2xs font-semibold text-tool-lime">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Verified
            </span>
          )}
        </div>

        {/* Collection & Granularity Selectors */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <div className="flex flex-col gap-1">
            <span className="text-3xs uppercase tracking-wider text-fg-subtle">Collection</span>
            <select
              value={selectedCollection}
              onChange={(e) => setSelectedCollection(e.target.value)}
              disabled={isRunning}
              className="rounded-xl border border-line bg-surface p-2 text-2xs text-fg"
            >
              <option value="">All Products</option>
              {collections.map((c) => (
                <option key={c.handle} value={c.handle}>
                  {c.title} {c.products_count ? `(${c.products_count})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-3xs uppercase tracking-wider text-fg-subtle">Granularity</span>
            <div className="flex items-center gap-3 pt-1 text-2xs text-fg">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="granularity"
                  checked={granularity === 'variant'}
                  onChange={() => setGranularity('variant')}
                  disabled={isRunning}
                  className="accent-tool-lime"
                />
                <span>Per Variant</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="granularity"
                  checked={granularity === 'product'}
                  onChange={() => setGranularity('product')}
                  disabled={isRunning}
                  className="accent-tool-lime"
                />
                <span>Per Product</span>
              </label>
            </div>
          </div>
        </div>
      </Card>

      {/* Execution & Live Progress Card */}
      <Card className="flex flex-col gap-2.5 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-fg">
            <Layers className="h-3.5 w-3.5 text-tool-lime" />
            <span>Extraction Control</span>
          </div>

          <div className="flex items-center gap-2">
            {isRunning ? (
              <Button
                variant="danger"
                size="sm"
                iconLeft={<StopCircle className="h-4 w-4" />}
                onClick={handleStop}
              >
                Stop
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                iconLeft={<Play className="h-4 w-4" />}
                onClick={() => void handleStart()}
                disabled={!storeUrl.trim()}
              >
                Start Extraction
              </Button>
            )}
          </div>
        </div>

        {/* Live Counters */}
        {(isRunning || extractedRecords.length > 0 || progress) && (
          <div className="border-t border-line/40 pt-2.5">
            <HarvestProgressStage
              compact
              count={extractedRecords.length}
              metricLabel={granularity === 'variant' ? 'VARIANTS EXTRACTED' : 'PRODUCTS EXTRACTED'}
              status={error && !isRunning ? 'failed' : !isRunning && createdDatasetId ? 'completed' : 'running'}
              stageLabel="Shopify Catalog"
              statusLabel={isRunning ? 'Syncing catalog…' : 'Complete'}
              progressSummary={`Products Found: ${progress?.productsFound ?? 0}`}
              pacingNotice={
                progress?.status === 'rate_limited'
                  ? `Rate limited by store. Waiting ${Math.round((progress.rateLimitWaitMs ?? 2000) / 1000)}s before retry…`
                  : isRunning
                    ? 'Keep this panel or workbench tab open while running'
                    : undefined
              }
              errorMessage={error}
              conveyorItems={recordsToConveyorItems(extractedRecords, 4)}
              feedLabel="Recent Products"
              emptyFeedText="Loading store catalog…"
            />
          </div>
        )}

        {/* Finished Actions */}
        {createdDatasetId && !isRunning && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-tool-lime/30 bg-tool-lime/10 p-2.5">
            <span className="text-2xs font-semibold text-tool-lime">
              Catalog extraction finished ({extractedRecords.length} rows)!
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="xs"
                iconLeft={<Download className="h-3 w-3" />}
                onClick={() => void handleExportShopifyCsv()}
              >
                Export Shopify CSV
              </Button>
              <Button
                variant="primary"
                size="xs"
                iconRight={<ExternalLink className="h-3 w-3" />}
                onClick={handleOpenTable}
              >
                Open Full Table ↗
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};

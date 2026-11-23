import type { ExtractedRecord } from '@/types';
import { escapeCsvCell } from './exporter';

export const SHOPIFY_ADMIN_HEADERS = [
  'Handle',
  'Title',
  'Body (HTML)',
  'Vendor',
  'Product Category',
  'Type',
  'Tags',
  'Published',
  'Option1 Name',
  'Option1 Value',
  'Option2 Name',
  'Option2 Value',
  'Option3 Name',
  'Option3 Value',
  'Variant SKU',
  'Variant Grams',
  'Variant Inventory Tracker',
  'Variant Inventory Qty',
  'Variant Inventory Policy',
  'Variant Fulfillment Service',
  'Variant Price',
  'Variant Compare At Price',
  'Variant Requires Shipping',
  'Variant Taxable',
  'Variant Barcode',
  'Image Src',
  'Image Position',
  'Image Alt Text',
  'Gift Card',
  'SEO Title',
  'SEO Description',
  'Google Shopping / Google Product Category',
  'Google Shopping / Gender',
  'Google Shopping / Age Group',
  'Google Shopping / MPN',
  'Google Shopping / Condition',
  'Google Shopping / Custom Product',
  'Google Shopping / Custom Label 0',
  'Google Shopping / Custom Label 1',
  'Google Shopping / Custom Label 2',
  'Google Shopping / Custom Label 3',
  'Google Shopping / Custom Label 4',
  'Variant Image',
  'Variant Weight Unit',
  'Variant Tax Code',
  'Cost per item',
  'Status',
] as const;

/**
 * Serializes extracted Shopify product records into valid Shopify Admin product-import CSV.
 * Properly handles multi-row variant formatting:
 * - Row 1 for a handle includes product metadata (Title, Body, Vendor, Type, Tags, etc.)
 * - Subsequent rows for the same handle only write Handle and variant-specific columns.
 */
export function recordsToShopifyCsv(records: ExtractedRecord[], useBom = true): string {
  const lines: string[] = [];

  // Header line
  lines.push(SHOPIFY_ADMIN_HEADERS.map((h) => escapeCsvCell(h)).join(','));

  const seenHandles = new Set<string>();

  for (const record of records) {
    const handle = String(record['Handle'] ?? record['handle'] ?? '').trim();
    const isFirstRowForHandle = !seenHandles.has(handle);
    if (handle) {
      seenHandles.add(handle);
    }

    const title = isFirstRowForHandle ? String(record['Title'] ?? record['title'] ?? '') : '';
    const body = isFirstRowForHandle ? String(record['Body (HTML)'] ?? record['body_html'] ?? '') : '';
    const vendor = isFirstRowForHandle ? String(record['Vendor'] ?? record['vendor'] ?? '') : '';
    const type = isFirstRowForHandle ? String(record['Type'] ?? record['type'] ?? '') : '';
    const tags = isFirstRowForHandle ? String(record['Tags'] ?? record['tags'] ?? '') : '';
    const published = isFirstRowForHandle
      ? String(record['Published'] ?? record['published'] ?? 'true')
      : '';

    const opt1Name = isFirstRowForHandle ? String(record['Option1 Name'] ?? 'Title') : '';
    const opt1Value = String(record['Option1 Value'] ?? 'Default Title');
    const opt2Name = isFirstRowForHandle ? String(record['Option2 Name'] ?? '') : '';
    const opt2Value = String(record['Option2 Value'] ?? '');
    const opt3Name = isFirstRowForHandle ? String(record['Option3 Name'] ?? '') : '';
    const opt3Value = String(record['Option3 Value'] ?? '');

    const sku = String(record['Variant SKU'] ?? record['sku'] ?? '');
    const grams = String(record['Variant Grams'] ?? record['grams'] ?? '0');
    const price = String(record['Variant Price'] ?? record['price'] ?? '0');
    const comparePrice = String(record['Variant Compare At Price'] ?? record['compare_at_price'] ?? '');
    const imageSrc = String(record['Image Src'] ?? record['image_src'] ?? '');
    const variantImg = String(record['Variant Image'] ?? record['variant_image'] ?? '');
    const status = isFirstRowForHandle ? 'active' : '';

    const rowValues = [
      handle,                                      // Handle
      title,                                       // Title
      body,                                        // Body (HTML)
      vendor,                                      // Vendor
      '',                                          // Product Category
      type,                                        // Type
      tags,                                        // Tags
      published,                                   // Published
      opt1Name,                                    // Option1 Name
      opt1Value,                                   // Option1 Value
      opt2Name,                                    // Option2 Name
      opt2Value,                                   // Option2 Value
      opt3Name,                                    // Option3 Name
      opt3Value,                                   // Option3 Value
      sku,                                         // Variant SKU
      grams,                                       // Variant Grams
      'shopify',                                   // Variant Inventory Tracker
      '1',                                         // Variant Inventory Qty
      'deny',                                      // Variant Inventory Policy
      'manual',                                    // Variant Fulfillment Service
      price,                                       // Variant Price
      comparePrice,                                // Variant Compare At Price
      'true',                                      // Variant Requires Shipping
      'true',                                      // Variant Taxable
      '',                                          // Variant Barcode
      imageSrc,                                    // Image Src
      '1',                                         // Image Position
      title,                                       // Image Alt Text
      'false',                                     // Gift Card
      title,                                       // SEO Title
      '',                                          // SEO Description
      '',                                          // Google Shopping / Google Product Category
      '',                                          // Google Shopping / Gender
      '',                                          // Google Shopping / Age Group
      '',                                          // Google Shopping / MPN
      'new',                                       // Google Shopping / Condition
      'false',                                     // Google Shopping / Custom Product
      '',                                          // Google Shopping / Custom Label 0
      '',                                          // Google Shopping / Custom Label 1
      '',                                          // Google Shopping / Custom Label 2
      '',                                          // Google Shopping / Custom Label 3
      '',                                          // Google Shopping / Custom Label 4
      variantImg,                                  // Variant Image
      'g',                                         // Variant Weight Unit
      '',                                          // Variant Tax Code
      '',                                          // Cost per item
      status,                                      // Status
    ];

    lines.push(rowValues.map(escapeCsvCell).join(','));
  }

  const output = lines.join('\r\n');
  return useBom ? `\uFEFF${output}` : output;
}

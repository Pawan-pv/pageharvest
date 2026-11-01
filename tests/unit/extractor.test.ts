import { describe, it, expect, beforeEach } from 'vitest';
import { extractRecordsFromContainers, extractFieldValue } from '@/core/extraction/extractor';
import { FieldDefinition } from '@/types';

describe('Data Extraction & Normalization Engine', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="results">
        <div class="row" data-sku="SKU-001">
          <h2 class="title">Portable Bluetooth Speaker</h2>
          <a class="buy" href="/item/speaker">Buy Now</a>
          <span class="cost">$49.99</span>
          <img src="/img/speaker.jpg" alt="Speaker" />
          <div class="specs">Battery: 12h playtime</div>
        </div>
        <div class="row" data-sku="SKU-002">
          <h2 class="title">Noise Cancelling Earbuds</h2>
          <a class="buy" href="/item/earbuds">Buy Now</a>
          <span class="cost">$129.50</span>
          <img src="/img/earbuds.jpg" alt="Earbuds" />
          <div class="specs">Battery: 24h playtime</div>
        </div>
        <!-- Duplicate of the first row -->
        <div class="row" data-sku="SKU-001">
          <h2 class="title">Portable Bluetooth Speaker</h2>
          <a class="buy" href="/item/speaker">Buy Now</a>
          <span class="cost">$49.99</span>
          <img src="/img/speaker.jpg" alt="Speaker" />
          <div class="specs">Battery: 12h playtime</div>
        </div>
      </div>
    `;
  });

  const fields: FieldDefinition[] = [
    { id: '1', name: 'Product Name', selector: '.title', extractor: 'text', required: true },
    { id: '2', name: 'Product Link', selector: '.buy', extractor: 'href' },
    { id: '3', name: 'Price', selector: '.cost', extractor: 'number' },
    { id: '4', name: 'Image URL', selector: 'img', extractor: 'src' },
    { id: '5', name: 'SKU', selector: ':scope', extractor: 'attribute', attributeName: 'data-sku' },
    {
      id: '6',
      name: 'Battery Hours',
      selector: '.specs',
      extractor: 'regex',
      regexPattern: 'Battery:\\s*(\\d+)h',
      regexGroup: 1,
    },
  ];

  it('extracts field values correctly according to extractor type', () => {
    const row = document.querySelector('.row')!;
    const nameVal = extractFieldValue(row.querySelector('.title'), fields[0]);
    const priceVal = extractFieldValue(row.querySelector('.cost'), fields[2]);
    const skuVal = extractFieldValue(row, fields[4]);
    const batteryVal = extractFieldValue(row.querySelector('.specs'), fields[5]);

    expect(nameVal).toBe('Portable Bluetooth Speaker');
    expect(priceVal).toBe(49.99);
    expect(skuVal).toBe('SKU-001');
    expect(batteryVal).toBe('12');
  });

  it('extracts records from all containers and suppresses duplicates', () => {
    const containers = Array.from(document.querySelectorAll('.row'));
    const seenHashes = new Set<string>();

    const result = extractRecordsFromContainers(containers, fields, 1, seenHashes, 'https://example.com');

    expect(result.totalParsed).toBe(3);
    // Row 3 is duplicate of row 1
    expect(result.duplicatesCount).toBe(1);
    expect(result.records).toHaveLength(2);

    const first = result.records[0];
    expect(first['Product Name']).toBe('Portable Bluetooth Speaker');
    expect(first['Price']).toBe(49.99);
    expect(first['Product Link']).toBe('https://example.com/item/speaker');
    expect(first['SKU']).toBe('SKU-001');
    expect(first['Battery Hours']).toBe('12');
    expect(first._page).toBe(1);
    expect(first._id).toBeDefined();

    const second = result.records[1];
    expect(second['Product Name']).toBe('Noise Cancelling Earbuds');
    expect(second['Price']).toBe(129.5);
    expect(second['Battery Hours']).toBe('24');
  });

  it('skips rows where required field is missing', () => {
    document.body.innerHTML += `
      <div class="row">
        <!-- Missing .title -->
        <a class="buy" href="/item/invalid">Buy Now</a>
        <span class="cost">$10</span>
      </div>
    `;

    const containers = Array.from(document.querySelectorAll('.row'));
    const seenHashes = new Set<string>();
    const result = extractRecordsFromContainers(containers, fields, 1, seenHashes);

    // Row 4 was skipped because .title was required
    expect(result.records).toHaveLength(2);
  });
});

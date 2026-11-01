import { describe, it, expect, beforeEach } from 'vitest';
import { loadFixtureHtml } from '../utils/dom-helpers';
import { extractRecordsFromScope } from '@/core/extraction/extractor';
import { DuplicateDetector } from '@/core/extraction/duplicate-detector';
import { PageHarvestDB } from '@/storage/db';
import { DatasetRepository } from '@/storage/repositories/dataset-repository';
import { ExtractionRecipe, FieldDefinition } from '@/types';
import { assertValidRecord } from '../utils/assertions';

describe('Integration: Extraction Pipeline & DOM Fixtures', () => {
  let db: PageHarvestDB;
  let datasetRepo: DatasetRepository;
  let duplicateDetector: DuplicateDetector;

  beforeEach(() => {
    db = new PageHarvestDB(`TestPipelineDB_${Math.random().toString(36).substring(2, 7)}`);
    datasetRepo = new DatasetRepository(db);
    duplicateDetector = new DuplicateDetector();
  });

  it('extracts structured records from simple-grid.html and stores them in Dexie', async () => {
    loadFixtureHtml('simple-grid.html');

    const fields: FieldDefinition[] = [
      { id: 'f1', name: 'title', selector: '.product-title', extractor: 'text' },
      { id: 'f2', name: 'price', selector: '.product-price', extractor: 'number' },
      { id: 'f3', name: 'link', selector: '.product-link', extractor: 'href' }
    ];

    const recipe: ExtractionRecipe = {
      id: 'recipe_simple',
      name: 'Simple Grid Recipe',
      urlPattern: 'http://127.0.0.1:3456/simple-grid.html',
      containerSelector: '.product-card',
      fields,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    const records = extractRecordsFromScope(document, recipe, 1, 'http://127.0.0.1:3456');
    expect(records.length).toBe(3);

    for (const record of records) {
      assertValidRecord(record);
      expect(typeof record.title).toBe('string');
      expect(typeof record.price).toBe('number');
      expect(typeof record.link).toBe('string');
      expect((record.link as string).startsWith('http')).toBe(true);
    }

    expect(records[0].title).toBe('Ergonomic Mechanical Keyboard');
    expect(records[0].price).toBe(129.99);

    // Persist to Dexie
    const datasetId = 'ds_simple_grid';
    await datasetRepo.createDataset({
      id: datasetId,
      name: 'Simple Grid Test Dataset',
      url: 'http://127.0.0.1:3456/simple-grid.html',
      recordsCount: 0,
      fields,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    const entities = records.map((r) => ({ ...r, datasetId }));
    await datasetRepo.addRecords(datasetId, entities);

    const stored = await datasetRepo.getRecordsByDataset(datasetId);
    expect(stored.length).toBe(3);
    expect(stored[0].title).toBe('Ergonomic Mechanical Keyboard');
  });

  it('extracts all 20 cards from twenty-cards.html', () => {
    loadFixtureHtml('twenty-cards.html');

    const recipe: ExtractionRecipe = {
      id: 'rec_20',
      name: '20 Cards',
      urlPattern: '*',
      containerSelector: '.catalog-item',
      fields: [
        { id: 'f1', name: 'title', selector: '.item-title', extractor: 'text' },
        { id: 'f2', name: 'sku', selector: '.item-sku', extractor: 'text' },
        { id: 'f3', name: 'price', selector: '.item-price', extractor: 'number' }
      ],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    const records = extractRecordsFromScope(document, recipe);
    expect(records.length).toBe(20);
    expect(records[0].title).toBe('Item 01 - Alpha Pro Headset');
    expect(records[19].title).toBe('Item 20 - Upsilon DisplayPort Cable 8K');
  });

  it('handles missing prices in missing-prices.html gracefully', () => {
    loadFixtureHtml('missing-prices.html');

    const recipe: ExtractionRecipe = {
      id: 'rec_missing',
      name: 'Missing Prices',
      urlPattern: '*',
      containerSelector: '.inventory-item',
      fields: [
        { id: 'f1', name: 'name', selector: '.name', extractor: 'text' },
        { id: 'f2', name: 'price', selector: '.price', extractor: 'number', defaultValue: '0' }
      ],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    const records = extractRecordsFromScope(document, recipe);
    expect(records.length).toBe(4);
    // Product Beta has no price element -> should receive defaultValue '0'
    expect(records[1].name).toBe('Product Beta');
    expect(records[1].price).toBe('0');
  });

  it('filters duplicate records in duplicate-records.html using DuplicateDetector', () => {
    loadFixtureHtml('duplicate-records.html');

    const recipe: ExtractionRecipe = {
      id: 'rec_dup',
      name: 'Deduplication Test',
      urlPattern: '*',
      containerSelector: '.item-card',
      fields: [
        { id: 'f1', name: 'title', selector: '.title', extractor: 'text' },
        { id: 'f2', name: 'price', selector: '.price', extractor: 'number' }
      ],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    const rawRecords = extractRecordsFromScope(document, recipe);
    expect(rawRecords.length).toBe(5); // 5 elements in HTML (3 duplicates of Item A)

    const uniqueRecords = [];
    let duplicatesFound = 0;

    for (const record of rawRecords) {
      const result = duplicateDetector.process(record, ['title', 'price']);
      if (!result.isDuplicate) {
        uniqueRecords.push(record);
      } else {
        duplicatesFound++;
      }
    }

    expect(uniqueRecords.length).toBe(3); // A, B, C
    expect(duplicatesFound).toBe(2); // 2 duplicate occurrences of Item A
  });

  it('yields 0 records on empty-page.html without throwing', () => {
    loadFixtureHtml('empty-page.html');

    const recipe: ExtractionRecipe = {
      id: 'rec_empty',
      name: 'Empty Page',
      urlPattern: '*',
      containerSelector: '.empty-product-grid .product-card',
      fields: [{ id: 'f1', name: 'title', selector: '.title', extractor: 'text' }],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    const records = extractRecordsFromScope(document, recipe);
    expect(records.length).toBe(0);
  });
});

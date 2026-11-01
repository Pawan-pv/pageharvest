import { describe, it, expect } from 'vitest';
import Dexie from 'dexie';
import { PageHarvestDB } from '@/storage/db';
import { SchemaRepository } from '@/storage/repositories/schema-repository';

describe('Storage Migration (v1 to current)', () => {
  it('migrates a v1 database to the current version while preserving all existing datasets, records, and converting recipes to schemas', async () => {
    const dbName = `MigrationTestDB_${Date.now()}`;

    // 1. Simulate legacy v1 database
    const v1Db = new Dexie(dbName);
    v1Db.version(1).stores({
      datasets: 'id, name, url, createdAt, updatedAt',
      records: '_id, datasetId, _page, _extractedAt',
      recipes: 'id, name, urlPattern, createdAt',
      history: 'id, datasetId, recipeId, status, startedAt, finishedAt',
    });

    await v1Db.open();

    // Populate v1 data
    const datasetTable = v1Db.table('datasets');
    const recordsTable = v1Db.table('records');
    const recipesTable = v1Db.table('recipes');

    await datasetTable.put({
      id: 'ds_legacy_1',
      name: 'Legacy E-Commerce Data',
      url: 'https://legacy.example.com',
      recordsCount: 2,
      createdAt: 1000,
      updatedAt: 1000,
    });

    await recordsTable.bulkPut([
      { _id: 'rec_v1_1', datasetId: 'ds_legacy_1', _page: 1, _extractedAt: 1000, title: 'Item 1', price: 99 },
      { _id: 'rec_v1_2', datasetId: 'ds_legacy_1', _page: 1, _extractedAt: 1050, title: 'Item 2', price: 149 },
    ]);

    await recipesTable.put({
      id: 'recipe_legacy_1',
      name: 'Legacy Recipe',
      urlPattern: 'https://legacy.example.com/*',
      containerSelector: '.card',
      fields: [
        { id: 'f1', name: 'title', selector: 'h2', extractor: 'text' },
        { id: 'f2', name: 'price', selector: '.price', extractor: 'number' },
      ],
      createdAt: 1000,
      updatedAt: 1000,
    });

    // Close v1 connection
    v1Db.close();

    // 2. Open with PageHarvestDB which defines every upgrade
    const migratedDb = new PageHarvestDB(dbName);
    await migratedDb.open();

    expect(migratedDb.verno).toBe(3);

    // Verify existing v1 records and datasets preserved
    const dataset = await migratedDb.datasets.get('ds_legacy_1');
    expect(dataset).toBeDefined();
    expect(dataset?.name).toBe('Legacy E-Commerce Data');

    const records = await migratedDb.records.where('datasetId').equals('ds_legacy_1').toArray();
    expect(records.length).toBe(2);
    expect(records[0].title).toBe('Item 1');

    // Verify recipes converted to schemas during migration
    const schemaRepo = new SchemaRepository(migratedDb);
    const migratedSchema = await schemaRepo.getSchema('recipe_legacy_1');
    expect(migratedSchema).toBeDefined();
    expect(migratedSchema?.name).toBe('Legacy Recipe');
    expect(migratedSchema?.containerSelector).toBe('.card');
    expect(migratedSchema?.fields.length).toBe(2);

    migratedDb.close();
  });
});

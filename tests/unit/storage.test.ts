import { describe, it, expect, beforeEach } from 'vitest';
import { PageHarvestDB } from '@/storage/db';
import { DatasetRepository } from '@/storage/repositories/dataset-repository';
import { RecipeRepository } from '@/storage/repositories/recipe-repository';
import { createMockDataset, createMockRecipe, createMockRecord } from '../utils/test-factories';

describe('Storage Persistence (Dexie / IndexedDB)', () => {
  let db: PageHarvestDB;
  let datasetRepo: DatasetRepository;
  let recipeRepo: RecipeRepository;

  beforeEach(async () => {
    // Unique in-memory DB instance per test run
    db = new PageHarvestDB(`TestHarvestDB_${Math.random().toString(36).substring(2, 8)}`);
    datasetRepo = new DatasetRepository(db);
    recipeRepo = new RecipeRepository(db);
  });

  describe('DatasetRepository', () => {
    it('creates and retrieves a dataset by ID', async () => {
      const mockDataset = createMockDataset({ id: 'ds_100', name: 'Laptops' });
      const id = await datasetRepo.createDataset(mockDataset);
      expect(id).toBe('ds_100');

      const retrieved = await datasetRepo.getDataset('ds_100');
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('Laptops');
    });

    it('lists all datasets ordered by createdAt descending', async () => {
      const ds1 = createMockDataset({ id: 'ds_1', createdAt: 1000 });
      const ds2 = createMockDataset({ id: 'ds_2', createdAt: 2000 });
      await datasetRepo.createDataset(ds1);
      await datasetRepo.createDataset(ds2);

      const all = await datasetRepo.getAllDatasets();
      expect(all.length).toBe(2);
      expect(all[0].id).toBe('ds_2'); // Newest first
    });

    it('adds records and auto-updates dataset record count transactionally', async () => {
      const ds = createMockDataset({ id: 'ds_rec_test', recordsCount: 0 });
      await datasetRepo.createDataset(ds);

      const records = [
        { ...createMockRecord({ _id: 'r1', title: 'Product 1' }), datasetId: 'ds_rec_test' },
        { ...createMockRecord({ _id: 'r2', title: 'Product 2' }), datasetId: 'ds_rec_test' }
      ];

      await datasetRepo.addRecords('ds_rec_test', records);

      const updatedDs = await datasetRepo.getDataset('ds_rec_test');
      expect(updatedDs?.recordsCount).toBe(2);

      const storedRecords = await datasetRepo.getRecordsByDataset('ds_rec_test');
      expect(storedRecords.length).toBe(2);
      expect(storedRecords[0].title).toBe('Product 1');
    });

    it('cascades deletion of records when dataset is deleted', async () => {
      const ds = createMockDataset({ id: 'ds_del' });
      await datasetRepo.createDataset(ds);

      const records = [
        { ...createMockRecord({ _id: 'r_del_1' }), datasetId: 'ds_del' }
      ];
      await datasetRepo.addRecords('ds_del', records);

      await datasetRepo.deleteDataset('ds_del');

      const dsAfter = await datasetRepo.getDataset('ds_del');
      expect(dsAfter).toBeUndefined();

      const recordsAfter = await datasetRepo.getRecordsByDataset('ds_del');
      expect(recordsAfter.length).toBe(0);
    });
  });

  describe('RecipeRepository', () => {
    it('saves, retrieves, and matches recipes by URL pattern', async () => {
      const recipe = createMockRecipe({
        id: 'rec_amazon',
        urlPattern: 'https://*.amazon.com/s*'
      });

      await recipeRepo.saveRecipe(recipe);

      const retrieved = await recipeRepo.getRecipe('rec_amazon');
      expect(retrieved?.id).toBe('rec_amazon');

      const matched = await recipeRepo.findRecipeForUrl('https://www.amazon.com/s?k=laptop');
      expect(matched).toBeDefined();
      expect(matched?.id).toBe('rec_amazon');

      const nonMatched = await recipeRepo.findRecipeForUrl('https://ebay.com/itm/123');
      expect(nonMatched).toBeUndefined();
    });
  });
});

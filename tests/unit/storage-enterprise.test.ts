import { describe, it, expect, beforeEach } from 'vitest';
import { PageHarvestDB } from '@/storage/db';
import {
  ProjectRepository,
  JobRepository,
  SchemaRepository,
  RecordRepository,
  HistoryRepository,
  SettingsRepository,
} from '@/storage/repositories';
import { ExtractionProject } from '@/shared/contracts/project';
import { ExtractionJobSchema } from '@/shared/contracts/job';
import { ExtractionSchema } from '@/shared/contracts/schema';
import { RecordEntity } from '@/types';

describe('Local Storage & Persistence Engine (Enterprise Normalized Model)', () => {
  let dbName: string;
  let db: PageHarvestDB;
  let projectRepo: ProjectRepository;
  let jobRepo: JobRepository;
  let schemaRepo: SchemaRepository;
  let recordRepo: RecordRepository;
  let historyRepo: HistoryRepository;
  let settingsRepo: SettingsRepository;

  beforeEach(() => {
    dbName = `TestHarvestDB_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    db = new PageHarvestDB(dbName);
    projectRepo = new ProjectRepository(db);
    jobRepo = new JobRepository(db);
    schemaRepo = new SchemaRepository(db);
    recordRepo = new RecordRepository(db);
    historyRepo = new HistoryRepository(db);
    settingsRepo = new SettingsRepository(db);
  });

  describe('Database Creation & Initialization', () => {
    it('creates database instance with normalized tables', () => {
      expect(db.projects).toBeDefined();
      expect(db.jobs).toBeDefined();
      expect(db.schemas).toBeDefined();
      expect(db.records).toBeDefined();
      expect(db.history).toBeDefined();
      expect(db.settings).toBeDefined();
      expect(db.datasets).toBeDefined();
    });
  });

  describe('Project CRUD & Persistence', () => {
    it('creates, retrieves, updates, and deletes projects', async () => {
      const mockProject: ExtractionProject = {
        id: 'proj_ecom_1',
        name: 'Amazon Electronics Scraper',
        description: 'Scrapes laptops and monitors',
        targetUrl: 'https://example.com/electronics',
        status: 'configured',
        schema: {
          id: 'schema_1',
          name: 'Product Card',
          urlPattern: 'https://example.com/*',
          containerSelector: '.product-item',
          fields: [
            {
              id: 'f1',
              name: 'Title',
              selector: 'h2',
              extractor: 'text',
              required: true,
              transform: 'trim',
            },
          ],
          pagination: {
            type: 'next_button',
            nextButtonSelector: 'a.next',
            maxPages: 10,
            delayMs: 1000,
            scrollCount: 20,
            scrollDelayMs: 1000,
            startPage: 1,
            pageIncrement: 1,
            stopCondition: 'no_new_records',
          },
          version: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        tags: ['shopping', 'electronics'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      // Create
      const createdId = await projectRepo.createProject(mockProject);
      expect(createdId).toBe('proj_ecom_1');

      // Read
      const retrieved = await projectRepo.getProject('proj_ecom_1');
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('Amazon Electronics Scraper');
      expect(retrieved?.tags).toEqual(['shopping', 'electronics']);

      // Update
      await projectRepo.updateProject('proj_ecom_1', { name: 'Updated Scraper' });
      const updated = await projectRepo.getProject('proj_ecom_1');
      expect(updated?.name).toBe('Updated Scraper');

      // Delete
      await projectRepo.deleteProject('proj_ecom_1');
      const deleted = await projectRepo.getProject('proj_ecom_1');
      expect(deleted).toBeUndefined();
    });
  });

  describe('Job Lifecycle & Execution History', () => {
    it('tracks jobs, transitions status, and saves history', async () => {
      const mockJob = ExtractionJobSchema.parse({
        id: 'job_101',
        projectId: 'proj_1',
        targetUrl: 'https://example.com/products',
        schema: {
          id: 's1',
          name: 'Schema',
          urlPattern: '*',
          containerSelector: '.card',
          fields: [{ id: 'f1', name: 'Name', selector: '.title', extractor: 'text', transform: 'trim', required: false }],
          pagination: { type: 'none', maxPages: 1, delayMs: 1000, scrollCount: 1, scrollDelayMs: 500, startPage: 1, pageIncrement: 1, stopCondition: 'no_new_records' },
          version: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        status: 'CREATED',
        totalExtracted: 0,
        duplicatesSkipped: 0,
        pagesVisited: 0,
        startedAt: Date.now(),
      });

      await jobRepo.createJob(mockJob);

      // Transition to running
      await jobRepo.updateJobStatus('job_101', 'RUNNING', { pagesVisited: 1 });
      let currentJob = await jobRepo.getJob('job_101');
      expect(currentJob?.status).toBe('RUNNING');
      expect(currentJob?.pagesVisited).toBe(1);

      // Transition to completed
      await jobRepo.updateJobStatus('job_101', 'COMPLETED', {
        totalExtracted: 50,
        duplicatesSkipped: 3,
        pagesVisited: 5,
      });
      currentJob = await jobRepo.getJob('job_101');
      expect(currentJob?.status).toBe('COMPLETED');
      expect(currentJob?.totalExtracted).toBe(50);
      expect(currentJob?.finishedAt).toBeDefined();

      // Record in history audit log
      await historyRepo.recordRun({
        id: 'hist_1',
        datasetId: 'ds_test',
        recipeId: 's1',
        status: 'COMPLETED',
        totalExtracted: 50,
        duplicatesSkipped: 3,
        startedAt: currentJob!.startedAt,
        finishedAt: currentJob!.finishedAt,
      });

      const history = await historyRepo.getHistoryByDataset('ds_test');
      expect(history.length).toBe(1);
      expect(history[0].totalExtracted).toBe(50);
    });
  });

  describe('Schemas & URL Pattern Matching', () => {
    it('saves and matches schemas with wildcard patterns', async () => {
      const schema: ExtractionSchema = {
        id: 'sch_quotes',
        name: 'Quotes to Scrape',
        urlPattern: 'https://quotes.toscrape.com/*',
        containerSelector: '.quote',
        fields: [
          { id: 'f1', name: 'quote', selector: '.text', extractor: 'text', transform: 'trim', required: false },
          { id: 'f2', name: 'author', selector: '.author', extractor: 'text', transform: 'trim', required: false },
        ],
        pagination: { type: 'none', maxPages: 5, delayMs: 1000, scrollCount: 10, scrollDelayMs: 500, startPage: 1, pageIncrement: 1, stopCondition: 'no_new_records' },
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await schemaRepo.createSchema(schema);

      const matched = await schemaRepo.findMatchingSchema('https://quotes.toscrape.com/page/1/');
      expect(matched).toBeDefined();
      expect(matched?.name).toBe('Quotes to Scrape');

      const unmatched = await schemaRepo.findMatchingSchema('https://books.toscrape.com/');
      expect(unmatched).toBeUndefined();
    });
  });

  describe('User Settings Persistence', () => {
    it('provides default settings and updates them', async () => {
      const defaultSettings = await settingsRepo.getSettings();
      expect(defaultSettings.defaultDelayMs).toBe(1500);
      expect(defaultSettings.defaultExportFormat).toBe('csv');
      expect(defaultSettings.csvIncludeBom).toBe(true);

      const updated = await settingsRepo.updateSettings({
        defaultDelayMs: 2500,
        defaultExportFormat: 'json',
        csvDelimiter: ';',
      });

      expect(updated.defaultDelayMs).toBe(2500);
      expect(updated.defaultExportFormat).toBe('json');
      expect(updated.csvDelimiter).toBe(';');

      const reloaded = await settingsRepo.getSettings();
      expect(reloaded.defaultDelayMs).toBe(2500);
    });
  });

  describe('Browser Restart Recovery Simulation', () => {
    it('persists records and recovers state across DB instance restarts', async () => {
      const dsId = 'ds_restart_test';
      const records: RecordEntity[] = [
        { _id: 'r1', datasetId: dsId, _page: 1, _extractedAt: 1000, title: 'Item 1', price: 10.5 },
        { _id: 'r2', datasetId: dsId, _page: 1, _extractedAt: 2000, title: 'Item 2', price: 20.0 },
      ];

      // Insert records in the first session
      await recordRepo.insertBatch(records);

      // Simulate browser restart: close existing connection
      db.close();

      // Open a new connection with the exact same DB name (simulating reopened side panel / restarted browser)
      const freshDb = new PageHarvestDB(dbName);
      const freshRecordRepo = new RecordRepository(freshDb);

      const { records: recovered, total } = await freshRecordRepo.getRecords({ datasetId: dsId });
      expect(total).toBe(2);
      expect(recovered.length).toBe(2);
      expect(recovered[0].title).toBe('Item 1');
      expect(recovered[1].title).toBe('Item 2');

      freshDb.close();
    });
  });

  describe('Large Dataset Handling (1,000+ records)', () => {
    it('handles bulk insertion, pagination, and sorting for 1,000 records smoothly', async () => {
      const datasetId = 'ds_large_1000';
      const batchSize = 1000;
      const records: RecordEntity[] = [];

      for (let i = 1; i <= batchSize; i++) {
        records.push({
          _id: `rec_large_${i}`,
          datasetId,
          _page: Math.ceil(i / 100),
          _extractedAt: 1700000000000 + i * 10,
          sku: `SKU-${String(i).padStart(4, '0')}`,
          title: `Product Title ${i}`,
          price: parseFloat((Math.random() * 500).toFixed(2)),
          inStock: i % 2 === 0,
        });
      }

      // Benchmark bulk insertion
      const startInsert = performance.now();
      const insertedCount = await recordRepo.insertBatch(records);
      const insertTime = performance.now() - startInsert;

      expect(insertedCount).toBe(1000);
      expect(insertTime).toBeLessThan(5000); // Must be fast

      // Test paginated retrieval (page 2, 50 items)
      const { records: page2, total } = await recordRepo.getRecords({
        datasetId,
        offset: 50,
        limit: 50,
        sortBy: '_extractedAt',
        sortOrder: 'asc',
      });

      expect(total).toBe(1000);
      expect(page2.length).toBe(50);
      expect(page2[0]._id).toBe('rec_large_51');
      expect(page2[49]._id).toBe('rec_large_100');

      // Test batch deletion
      const deletedCount = await recordRepo.deleteBatch(['rec_large_1', 'rec_large_2'], datasetId);
      expect(deletedCount).toBe(2);

      const remaining = await recordRepo.getRecords({ datasetId });
      expect(remaining.total).toBe(998);
    });
  });
});

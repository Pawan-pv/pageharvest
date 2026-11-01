import Dexie, { type Table } from 'dexie';
import {
  DatasetEntity,
  RecordEntity,
  ExtractionRecipe,
  ExtractionRunHistory,
  UserSettings,
  DEFAULT_USER_SETTINGS,
} from '@/types';
import { ExtractionProject } from '@/shared/contracts/project';
import { ExtractionJob } from '@/shared/contracts/job';
import { ExtractionSchema } from '@/shared/contracts/schema';

export type { RecordEntity };

export class PageHarvestDB extends Dexie {
  datasets!: Table<DatasetEntity, string>;
  records!: Table<RecordEntity, string>;
  recipes!: Table<ExtractionRecipe, string>;
  history!: Table<ExtractionRunHistory, string>;
  projects!: Table<ExtractionProject, string>;
  jobs!: Table<ExtractionJob, string>;
  schemas!: Table<ExtractionSchema, string>;
  settings!: Table<UserSettings, string>;

  constructor(dbName: string = 'PageHarvestDB') {
    super(dbName);

    // Version 1: Initial schema
    this.version(1).stores({
      datasets: 'id, name, url, createdAt, updatedAt',
      records: '_id, datasetId, _page, _extractedAt',
      recipes: 'id, name, urlPattern, createdAt',
      history: 'id, datasetId, recipeId, status, startedAt, finishedAt',
    });

    // Version 2: Normalized enterprise model (Projects, Jobs, Schemas, Settings, enhanced Record indexing)
    this.version(2)
      .stores({
        datasets: 'id, name, url, createdAt, updatedAt',
        records: '_id, datasetId, _jobId, _projectId, _page, _extractedAt, _hash',
        recipes: 'id, name, urlPattern, createdAt',
        history: 'id, datasetId, jobId, recipeId, status, startedAt, finishedAt',
        projects: 'id, name, status, createdAt, updatedAt',
        jobs: 'id, projectId, status, startedAt, finishedAt',
        schemas: 'id, name, urlPattern, createdAt, updatedAt',
        settings: 'id, updatedAt',
      })
      .upgrade(async (tx) => {
        // Upgrade migration: seed default user settings if missing
        const settingsTable = tx.table<UserSettings, string>('settings');
        const existingSettings = await settingsTable.get('current');
        if (!existingSettings) {
          await settingsTable.put(DEFAULT_USER_SETTINGS);
        }

        // Migrate recipes to schemas if any recipes exist
        const recipesTable = tx.table<ExtractionRecipe, string>('recipes');
        const schemasTable = tx.table<ExtractionSchema, string>('schemas');
        const recipes = await recipesTable.toArray();
        for (const recipe of recipes) {
          const existingSchema = await schemasTable.get(recipe.id);
          if (!existingSchema) {
            await schemasTable.put({
              id: recipe.id,
              name: recipe.name,
              urlPattern: recipe.urlPattern,
              containerSelector: recipe.containerSelector,
              fields: recipe.fields.map((f) => ({
                id: f.id,
                name: f.name,
                selector: f.selector,
                extractor: f.extractor,
                attributeName: f.attributeName,
                regexPattern: f.regexPattern,
                regexGroup: f.regexGroup ?? 0,
                defaultValue: f.defaultValue,
                required: f.required ?? false,
                transform: 'trim',
              })),
              pagination: recipe.pagination ?? {
                type: 'none',
                maxPages: 20,
                delayMs: 1500,
                scrollCount: 30,
                scrollDelayMs: 1500,
              },
              version: 1,
              createdAt: recipe.createdAt,
              updatedAt: recipe.updatedAt,
            });
          }
        }
      });
  }

  /**
   * Transactional batch insert for extracted records with dataset count update.
   */
  async saveExtractedBatch(datasetId: string, newRecords: RecordEntity[]): Promise<number> {
    if (newRecords.length === 0) return 0;

    return await this.transaction('rw', this.datasets, this.records, async () => {
      const recordsToInsert: RecordEntity[] = newRecords.map((r) => ({
        ...r,
        datasetId: r.datasetId || datasetId,
      }));

      await this.records.bulkPut(recordsToInsert);

      const dataset = await this.datasets.get(datasetId);
      if (dataset) {
        const count = await this.records.where('datasetId').equals(datasetId).count();
        await this.datasets.update(datasetId, {
          recordsCount: count,
          updatedAt: Date.now(),
        });
      }

      return recordsToInsert.length;
    });
  }

  /**
   * Retrieves all records for a dataset, ordered by page and extraction time.
   */
  async getDatasetRecords(datasetId: string): Promise<RecordEntity[]> {
    return await this.records
      .where('datasetId')
      .equals(datasetId)
      .sortBy('_extractedAt');
  }

  /**
   * Deletes a dataset and all associated records in a single transaction.
   */
  async deleteDatasetWithRecords(datasetId: string): Promise<void> {
    await this.transaction('rw', this.datasets, this.records, async () => {
      await this.records.where('datasetId').equals(datasetId).delete();
      await this.datasets.delete(datasetId);
    });
  }

  /**
   * Updates an individual record cell in a dataset.
   */
  async updateRecordCell(
    recordId: string,
    field: string,
    value: string | number | null
  ): Promise<void> {
    await this.records.update(recordId, {
      [field]: value,
    });
  }

  /**
   * Deletes an individual record from a dataset and updates total count.
   */
  async deleteRecord(datasetId: string, recordId: string): Promise<void> {
    await this.transaction('rw', this.datasets, this.records, async () => {
      await this.records.delete(recordId);
      const remainingCount = await this.records.where('datasetId').equals(datasetId).count();
      await this.datasets.update(datasetId, {
        recordsCount: remainingCount,
        updatedAt: Date.now(),
      });
    });
  }

  /**
   * Wipes all tables across the database.
   */
  async clearAllData(): Promise<void> {
    await this.transaction('rw', [
      this.datasets,
      this.records,
      this.recipes,
      this.history,
      this.projects,
      this.jobs,
      this.schemas,
      this.settings,
    ], async () => {
      await Promise.all([
        this.datasets.clear(),
        this.records.clear(),
        this.recipes.clear(),
        this.history.clear(),
        this.projects.clear(),
        this.jobs.clear(),
        this.schemas.clear(),
        this.settings.clear(),
      ]);
    });
  }
}

// Singleton database instance
export const db = new PageHarvestDB();

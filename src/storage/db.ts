import Dexie, { type Table } from 'dexie';
import {
  DatasetEntity,
  RecordEntity,
  ExtractionRecipe,
  ExtractionRunHistory,
  UserSettings,
} from '@/types';
import { ExtractionProject } from '@/shared/contracts/project';
import { ExtractionJob, JobCheckpoint, JobStatus } from '@/shared/contracts/job';
import { ExtractionSchema } from '@/shared/contracts/schema';
import { UserSettingsSchema } from '@/shared/contracts/settings';

export type { RecordEntity };

/** Multiplier that keeps row positions stable: order = sequence * stride + index. */
export const RECORD_ORDER_STRIDE = 1_000_000;

// Jobs written before version 3 have no checkpoint, so they can never be resumed.
const LEGACY_JOB_STATUS: Record<string, JobStatus> = {
  queued: 'CANCELLED',
  running: 'FAILED',
  paused: 'FAILED',
  completed: 'COMPLETED',
  failed: 'FAILED',
  stopped: 'CANCELLED',
};

const LEGACY_RUN_STATUS: Record<string, JobStatus> = {
  IDLE: 'CREATED',
  INSPECTING: 'CREATED',
  EXTRACTING: 'CANCELLED',
  PAGINATING: 'CANCELLED',
  PAUSED: 'CANCELLED',
  ERROR: 'FAILED',
};

function trailingIndex(id: string): number {
  const match = /_(\d+)$/.exec(id);
  return match ? Number(match[1]) : 0;
}

/**
 * Display order of a dataset's rows. Rows written since version 3 carry an explicit
 * `_order`. Older rows fall back to page, extraction time, then the row index their
 * generated ID ends with, because rows from one page often share a timestamp.
 */
export function compareRecordOrder(a: RecordEntity, b: RecordEntity): number {
  if (typeof a._order === 'number' && typeof b._order === 'number' && a._order !== b._order) {
    return a._order - b._order;
  }
  return (
    (a._page ?? 0) - (b._page ?? 0) ||
    (a._extractedAt ?? 0) - (b._extractedAt ?? 0) ||
    trailingIndex(a._id) - trailingIndex(b._id)
  );
}

export class PageHarvestDB extends Dexie {
  datasets!: Table<DatasetEntity, string>;
  records!: Table<RecordEntity, string>;
  recipes!: Table<ExtractionRecipe, string>;
  history!: Table<ExtractionRunHistory, string>;
  projects!: Table<ExtractionProject, string>;
  jobs!: Table<ExtractionJob, string>;
  checkpoints!: Table<JobCheckpoint, string>;
  schemas!: Table<ExtractionSchema, string>;
  settings!: Table<UserSettings, string>;

  constructor(dbName: string = 'PageHarvestDB') {
    super(dbName);

    // Version 1: Initial schema with all core and normalized tables
    this.version(1).stores({
      datasets: 'id, name, url, createdAt, updatedAt',
      records: '_id, datasetId, _page, _extractedAt',
      recipes: 'id, name, urlPattern, createdAt',
      history: 'id, datasetId, recipeId, status, startedAt, finishedAt',
      projects: 'id, name, status, createdAt, updatedAt',
      jobs: 'id, projectId, status, startedAt, finishedAt',
      schemas: 'id, name, urlPattern, createdAt, updatedAt',
      settings: 'id, updatedAt',
    });

    // Version 2: Enhanced indexing for high-speed multi-field queries & foreign keys
    this.version(2)
      .stores({
        records: '_id, datasetId, _jobId, _projectId, _page, _extractedAt, _hash',
        history: 'id, datasetId, jobId, recipeId, status, startedAt, finishedAt',
      })
      .upgrade(async (tx) => {
        const recipesTable = tx.table<ExtractionRecipe, string>('recipes');
        const schemasTable = tx.table<ExtractionSchema, string>('schemas');
        const recipes = await recipesTable.toArray();
        for (const recipe of recipes) {
          await schemasTable.put({
            id: recipe.id,
            name: recipe.name,
            urlPattern: recipe.urlPattern,
            containerSelector: recipe.containerSelector,
            fields: (recipe.fields || []).map((f) => ({
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
            pagination: {
              type: recipe.pagination?.type ?? 'none',
              nextButtonSelector: recipe.pagination?.nextButtonSelector,
              maxPages: recipe.pagination?.maxPages ?? 20,
              delayMs: recipe.pagination?.delayMs ?? 1500,
              scrollCount: recipe.pagination?.scrollCount ?? 30,
              scrollDelayMs: recipe.pagination?.scrollDelayMs ?? 1500,
              urlTemplate: recipe.pagination?.urlTemplate,
              startPage: recipe.pagination?.startPage ?? 1,
              pageIncrement: recipe.pagination?.pageIncrement ?? 1,
              stopCondition: recipe.pagination?.stopCondition ?? 'no_new_records',
            },
            version: 1,
            createdAt: recipe.createdAt,
            updatedAt: recipe.updatedAt,
          });
        }
      });

    // Version 3: Durable job lifecycle, checkpoints, associations and stable row order.
    // A failure here aborts the upgrade and leaves version 2 data untouched.
    this.version(3)
      .stores({
        datasets: 'id, name, url, projectId, jobId, createdAt, updatedAt',
        records: '_id, datasetId, _jobId, _projectId, _page, _extractedAt, _hash, [datasetId+_hash]',
        recipes: 'id, name, urlPattern, schemaId, projectId, createdAt, updatedAt',
        history: 'id, datasetId, jobId, projectId, recipeId, status, startedAt, finishedAt',
        jobs: 'id, projectId, datasetId, status, tabId, startedAt, finishedAt',
        schemas: 'id, name, urlPattern, projectId, createdAt, updatedAt',
        checkpoints: 'jobId, tabId, updatedAt, expiresAt',
      })
      .upgrade(async (tx) => {
        await tx
          .table<ExtractionJob, string>('jobs')
          .toCollection()
          .modify((job) => {
            const status = LEGACY_JOB_STATUS[job.status as string];
            if (status) job.status = status;
            job.progressKind = job.progressKind ?? 'pages';
            job.lastSequence = job.lastSequence ?? 0;
            job.scrollsCompleted = job.scrollsCompleted ?? 0;
            job.recordsDetected = job.recordsDetected ?? job.totalExtracted ?? 0;
            job.recordsWithMissingFields = job.recordsWithMissingFields ?? 0;
            job.recordsFiltered = job.recordsFiltered ?? 0;
            job.recordsFailed = job.recordsFailed ?? 0;
            job.consecutiveEmptySteps = job.consecutiveEmptySteps ?? 0;
            job.pausedMs = job.pausedMs ?? 0;
            job.errors = job.errors ?? [];
            job.updatedAt = job.updatedAt ?? job.startedAt;
          });

        await tx
          .table<ExtractionRunHistory, string>('history')
          .toCollection()
          .modify((run) => {
            const status = LEGACY_RUN_STATUS[run.status as string];
            if (status) run.status = status;
          });

        const settingsTable = tx.table<UserSettings, string>('settings');
        for (const stored of await settingsTable.toArray()) {
          await settingsTable.put(migrateStoredSettings(stored));
        }

        // Give existing rows an explicit, stable position.
        const recordsTable = tx.table<RecordEntity, string>('records');
        const byDataset = new Map<string, RecordEntity[]>();
        await recordsTable.each((record) => {
          const key = record.datasetId ?? '';
          const group = byDataset.get(key);
          if (group) group.push(record);
          else byDataset.set(key, [record]);
        });
        for (const group of byDataset.values()) {
          group.sort(compareRecordOrder);
          group.forEach((record, index) => {
            record._order = (index + 1) * RECORD_ORDER_STRIDE;
          });
          await recordsTable.bulkPut(group);
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
   * Retrieves all records for a dataset in extraction order.
   */
  async getDatasetRecords(datasetId: string): Promise<RecordEntity[]> {
    const records = await this.records.where('datasetId').equals(datasetId).toArray();
    return records.sort(compareRecordOrder);
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
   * Removes everything the user has collected or saved, while keeping preferences.
   * Refuses while a job is executing, because that job would have nowhere to write.
   */
  async clearUserData(): Promise<void> {
    await this.transaction(
      'rw',
      [
        this.datasets,
        this.records,
        this.recipes,
        this.history,
        this.projects,
        this.jobs,
        this.checkpoints,
        this.schemas,
      ],
      async () => {
        const running = await this.jobs.where('status').anyOf(['CREATED', 'RUNNING', 'PAUSED']).count();
        if (running > 0) {
          throw new Error('An extraction is still running. Stop it before clearing saved data.');
        }
        await Promise.all([
          this.datasets.clear(),
          this.records.clear(),
          this.recipes.clear(),
          this.history.clear(),
          this.projects.clear(),
          this.jobs.clear(),
          this.checkpoints.clear(),
          this.schemas.clear(),
        ]);
      }
    );
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
      this.checkpoints,
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
        this.checkpoints.clear(),
        this.schemas.clear(),
        this.settings.clear(),
      ]);
    });
  }
}

/**
 * Brings a stored settings row of any earlier shape up to the current version.
 * Values that are still valid are kept; invalid or unknown ones fall back to defaults.
 */
export function migrateStoredSettings(stored: unknown): UserSettings {
  const raw = (typeof stored === 'object' && stored !== null ? stored : {}) as Record<string, unknown>;
  const defaults = UserSettingsSchema.parse({ id: 'current' });
  const merged: Record<string, unknown> = { ...defaults };

  for (const key of Object.keys(defaults) as Array<keyof UserSettings>) {
    if (raw[key] === undefined || key === 'schemaVersion') continue;
    const candidate = UserSettingsSchema.shape[key].safeParse(raw[key]);
    if (candidate.success) merged[key] = candidate.data;
  }

  return UserSettingsSchema.parse(merged);
}

// Singleton database instance
export const db = new PageHarvestDB();

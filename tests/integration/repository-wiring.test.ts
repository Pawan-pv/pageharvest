import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExtractionJobSchema } from '@/shared/contracts/job';
import { PageHarvestDB } from '@/storage/db';
import {
  DatasetRepository,
  JobRepository,
  ProjectRepository,
  RecipeRepository,
  RecordRepository,
  SchemaRepository,
  SettingsRepository,
} from '@/storage/repositories';
import { BASE_URL, ExtensionHarness, makeBatch, makeRecipe, renderCards, uniqueDb } from '../utils/job-harness';

const TAB = 801;

describe('Repositories used by production', () => {
  let harness: ExtensionHarness;
  let db: PageHarvestDB;

  beforeEach(() => {
    harness = new ExtensionHarness();
    db = harness.db;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    db.close();
    await db.delete();
  });

  async function finishedJob() {
    renderCards(['Alpha', 'Beta']);
    harness.loadPage(TAB, `${BASE_URL}/list`);
    const identity = await harness.start(TAB, makeRecipe());
    await harness.settled(TAB);
    return identity;
  }

  describe('projects', () => {
    it('groups jobs by website, and finds an existing project instead of duplicating it', async () => {
      const repository = new ProjectRepository(db);
      const first = await repository.findOrCreateByName('example.com', 'https://example.com/');
      const second = await repository.findOrCreateByName('example.com', 'https://example.com/other');
      expect(second.id).toBe(first.id);
      expect(await repository.getAllProjects()).toHaveLength(1);
    });

    it('lets a job run inside a chosen project', async () => {
      const projects = new ProjectRepository(db);
      await projects.createProject({
        id: 'project_chosen',
        name: 'Chosen',
        status: 'draft',
        tags: [],
        createdAt: 1,
        updatedAt: 1,
      });
      renderCards(['Alpha']);
      harness.loadPage(TAB, `${BASE_URL}/list`);

      const identity = await harness.start(TAB, makeRecipe(), `${BASE_URL}/list`, { projectId: 'project_chosen' });
      await harness.settled(TAB);

      expect(identity.projectId).toBe('project_chosen');
      expect((await db.datasets.get(identity.datasetId))?.projectId).toBe('project_chosen');
    });

    it('rejects a job for a project that no longer exists', async () => {
      harness.loadPage(TAB, `${BASE_URL}/list`);
      const result = await harness.coordinator.startJob({
        recipe: makeRecipe(),
        tabId: TAB,
        sourceUrl: `${BASE_URL}/list`,
        projectId: 'project_gone',
      });
      expect(result.ok).toBe(false);
      expect(await db.jobs.count()).toBe(0);
    });

    it('reports usage before deletion', async () => {
      const identity = await finishedJob();
      const usage = await new ProjectRepository(db).getUsage(identity.projectId);
      expect(usage).toEqual({ datasets: 1, records: 2, jobs: 1, activeJobs: 0 });
    });

    it('deletes a project with everything it owns, and only that', async () => {
      const kept = await finishedJob();
      const { coordinator } = harness.loadPage(TAB + 1, 'https://other.example.com/list');
      vi.spyOn(coordinator, 'extractRecords').mockReturnValue({ accepted: true });
      const removed = await harness.start(TAB + 1, makeRecipe({ type: 'next_button' }), 'https://other.example.com/list');
      await harness.sendFromPage(TAB + 1, makeBatch(removed, 1, ['Gone']));
      await harness.coordinator.finishJob(removed.jobId);

      await new ProjectRepository(db).deleteProject(removed.projectId);

      expect(await db.projects.get(removed.projectId)).toBeUndefined();
      expect(await db.datasets.get(removed.datasetId)).toBeUndefined();
      expect(await db.jobs.get(removed.jobId)).toBeUndefined();
      expect(await db.records.where('datasetId').equals(removed.datasetId).count()).toBe(0);
      expect(await db.history.where('projectId').equals(removed.projectId).count()).toBe(0);

      expect(await db.records.where('datasetId').equals(kept.datasetId).count()).toBe(2);
      expect(await db.jobs.get(kept.jobId)).toBeDefined();
    });

    it('refuses to delete a project with a job still running, changing nothing', async () => {
      const { coordinator } = harness.loadPage(TAB, `${BASE_URL}/list`);
      vi.spyOn(coordinator, 'extractRecords').mockReturnValue({ accepted: true });
      const running = await harness.start(TAB, makeRecipe({ type: 'next_button' }));

      await expect(new ProjectRepository(db).deleteProject(running.projectId)).rejects.toThrow(/running/);

      expect(await db.projects.get(running.projectId)).toBeDefined();
      expect(await db.jobs.get(running.jobId)).toBeDefined();
    });

    it('keeps saved recipes and schemas when their project goes, without a dangling link', async () => {
      const identity = await finishedJob();
      await new RecipeRepository(db).saveRecipe({ ...makeRecipe(), id: 'r1', projectId: identity.projectId });
      const [schema] = await db.schemas.toArray();

      await new ProjectRepository(db).deleteProject(identity.projectId);

      expect((await db.recipes.get('r1'))?.projectId).toBeUndefined();
      expect((await db.schemas.get(schema.id))?.projectId).toBeUndefined();
    });
  });

  describe('jobs', () => {
    it('finds the active job for a tab and ignores finished ones', async () => {
      const repository = new JobRepository(db);
      const identity = await finishedJob();
      expect(await repository.findActiveJobForTab(TAB)).toBeUndefined();

      const { coordinator } = harness.loadPage(TAB, `${BASE_URL}/list`);
      vi.spyOn(coordinator, 'extractRecords').mockReturnValue({ accepted: true });
      const running = await harness.start(TAB, makeRecipe({ type: 'next_button' }));

      expect((await repository.findActiveJobForTab(TAB))?.id).toBe(running.jobId);
      expect((await repository.getJob(identity.jobId))?.status).toBe('COMPLETED');
    });

    it('deletes a job with its checkpoint', async () => {
      const { coordinator } = harness.loadPage(TAB, `${BASE_URL}/list`);
      vi.spyOn(coordinator, 'extractRecords').mockReturnValue({ accepted: true });
      const running = await harness.start(TAB, makeRecipe({ type: 'next_button' }));

      await new JobRepository(db).deleteJob(running.jobId);

      expect(await db.checkpoints.get(running.jobId)).toBeUndefined();
    });
  });

  describe('schemas', () => {
    it('refuses to delete a schema a recipe still uses', async () => {
      const identity = await finishedJob();
      const job = await db.jobs.get(identity.jobId);
      const schemaId = job?.schemaId as string;
      await new RecipeRepository(db).saveRecipe({ ...makeRecipe(), id: 'r1', schemaId });
      const repository = new SchemaRepository(db);

      await expect(repository.deleteSchema(schemaId)).rejects.toThrow(/used by 1 saved recipe/);
      expect(await repository.getSchema(schemaId)).toBeDefined();

      await new RecipeRepository(db).deleteRecipe('r1');
      await repository.deleteSchema(schemaId);
      expect(await repository.getSchema(schemaId)).toBeUndefined();
      // The job keeps its own copy of the configuration it ran with.
      expect((await db.jobs.get(identity.jobId))?.schema.containerSelector).toBe('.card');
    });

    it('updates a schema in place', async () => {
      await finishedJob();
      const repository = new SchemaRepository(db);
      const [schema] = await repository.getAllSchemas();

      await repository.updateSchema(schema.id, { name: 'Renamed' });

      expect((await repository.getSchema(schema.id))?.name).toBe('Renamed');
    });
  });

  describe('recipes', () => {
    it('saves, lists, edits, loads and deletes a recipe', async () => {
      const repository = new RecipeRepository(db);
      await repository.saveRecipe({ ...makeRecipe(), id: 'r1', name: 'Original' });

      await repository.updateRecipe('r1', { name: 'Edited', containerSelector: '.item' });

      expect((await repository.getAllRecipes()).map((r) => r.name)).toEqual(['Edited']);
      expect((await repository.getRecipe('r1'))?.containerSelector).toBe('.item');

      await repository.deleteRecipe('r1');
      expect(await repository.getRecipe('r1')).toBeUndefined();
    });

    it('reports editing a recipe that no longer exists', async () => {
      await expect(new RecipeRepository(db).updateRecipe('missing', { name: 'x' })).rejects.toThrow(/no longer exists/);
    });

    it('records which recipe a job ran from', async () => {
      await new RecipeRepository(db).saveRecipe({ ...makeRecipe(), id: 'r1' });
      renderCards(['Alpha']);
      harness.loadPage(TAB, `${BASE_URL}/list`);

      const identity = await harness.start(TAB, makeRecipe(), `${BASE_URL}/list`, { recipeId: 'r1' });
      await harness.settled(TAB);

      expect((await db.jobs.get(identity.jobId))?.recipeId).toBe('r1');
      expect((await db.datasets.get(identity.datasetId))?.recipeId).toBe('r1');
      expect((await db.history.where('jobId').equals(identity.jobId).first())?.recipeId).toBe('r1');
    });
  });

  describe('history', () => {
    it('records completed, failed and cancelled runs with their project and job', async () => {
      const completed = await finishedJob();

      const failed = await harness.start(
        TAB,
        makeRecipe({}, { containerSelector: '###bad' }),
        `${BASE_URL}/list`
      );
      await harness.settled(TAB);

      const { coordinator } = harness.loadPage(TAB + 1, `${BASE_URL}/list`);
      vi.spyOn(coordinator, 'extractRecords').mockReturnValue({ accepted: true });
      const cancelled = await harness.start(TAB + 1, makeRecipe({ type: 'next_button' }));
      await harness.coordinator.cancelJob(cancelled.jobId);

      const runs = await db.history.toArray();
      const statusOf = (jobId: string) => runs.find((run) => run.jobId === jobId);
      expect(statusOf(completed.jobId)).toMatchObject({
        status: 'COMPLETED',
        projectId: completed.projectId,
        totalExtracted: 2,
      });
      expect(statusOf(failed.jobId)).toMatchObject({ status: 'FAILED', errorMessage: expect.any(String) });
      expect(statusOf(cancelled.jobId)).toMatchObject({ status: 'CANCELLED' });
    });
  });

  describe('dataset edits', () => {
    it('applies renames, deletions and column changes as one transaction', async () => {
      const identity = await finishedJob();
      const repository = new DatasetRepository(db);
      const rows = await repository.getRecordsByDataset(identity.datasetId);

      await repository.applyEdit(
        identity.datasetId,
        [{ ...rows[0], Name: rows[0].Title, Title: undefined }],
        [{ id: 'n', name: 'Name', selector: '.title', extractor: 'text' }]
      );

      const stored = await repository.getRecordsByDataset(identity.datasetId);
      expect(stored).toHaveLength(1);
      expect(stored[0].Name).toBe('Alpha');
      expect((await repository.getDataset(identity.datasetId))?.recordsCount).toBe(1);
    });

    it('changes nothing when the transaction fails', async () => {
      const identity = await finishedJob();
      const repository = new DatasetRepository(db);
      vi.spyOn(db.datasets, 'update').mockRejectedValueOnce(new Error('disk full'));

      await expect(repository.applyEdit(identity.datasetId, [], [])).rejects.toThrow('disk full');

      expect(await repository.getRecordsByDataset(identity.datasetId)).toHaveLength(2);
    });

    it('reports a cell edit on a row that is gone', async () => {
      await expect(new RecordRepository(db).updateCell('missing', 'a', 'b')).rejects.toThrow(/no longer exists/);
    });
  });

  describe('clearing saved data', () => {
    it('removes everything collected but keeps preferences', async () => {
      await finishedJob();
      await new RecipeRepository(db).saveRecipe({ ...makeRecipe(), id: 'r1' });
      await new SettingsRepository(db).updateSettings({ defaultMaxPages: 77 });

      await db.clearUserData();

      for (const table of [db.datasets, db.records, db.recipes, db.history, db.projects, db.jobs, db.checkpoints, db.schemas]) {
        expect(await table.count()).toBe(0);
      }
      expect((await new SettingsRepository(db).getSettings()).defaultMaxPages).toBe(77);
    });

    it('refuses while a job is running, changing nothing', async () => {
      const { coordinator } = harness.loadPage(TAB, `${BASE_URL}/list`);
      vi.spyOn(coordinator, 'extractRecords').mockReturnValue({ accepted: true });
      await harness.start(TAB, makeRecipe({ type: 'next_button' }));

      await expect(db.clearUserData()).rejects.toThrow(/still running/);

      expect(await db.jobs.count()).toBe(1);
    });
  });
});

describe('Settings', () => {
  let db: PageHarvestDB;

  beforeEach(() => {
    db = uniqueDb();
  });

  afterEach(async () => {
    db.close();
    await db.delete();
  });

  it('rejects invalid values without writing them', async () => {
    const repository = new SettingsRepository(db);

    await expect(repository.updateSettings({ defaultDelayMs: 5 })).rejects.toThrow();
    await expect(repository.updateSettings({ defaultMaxPages: 0 })).rejects.toThrow();

    expect((await repository.getSettings()).defaultDelayMs).toBe(1500);
  });

  it('updates one setting without touching the others', async () => {
    const repository = new SettingsRepository(db);
    await repository.updateSettings({ defaultMaxPages: 40, csvDelimiter: ';' });
    await repository.updateSettings({ defaultMaxPages: 50 });

    expect(await repository.getSettings()).toMatchObject({ defaultMaxPages: 50, csvDelimiter: ';' });
  });

  it('upgrades a row from an earlier version, keeping valid values', async () => {
    await db.settings.put({
      id: 'current',
      theme: 'dark',
      autoCleanOnExtract: true,
      csvDelimiter: ';',
      csvIncludeBom: false,
      jsonIndent: 99,
      retentionDays: 14,
      updatedAt: 1,
    } as never);

    const settings = await new SettingsRepository(db).getSettings();

    expect(settings).toMatchObject({
      schemaVersion: 2,
      csvDelimiter: ';',
      csvIncludeBom: false,
      retentionDays: 14,
      jsonIndent: 2,
      defaultDelayMs: 1500,
    });
    expect(settings).not.toHaveProperty('theme');
  });
});

describe('Database migrations', () => {
  const name = () => `MigrationDB_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  function openV2(dbName: string): Dexie {
    const legacy = new Dexie(dbName);
    legacy.version(2).stores({
      datasets: 'id, name, url, createdAt, updatedAt',
      records: '_id, datasetId, _jobId, _projectId, _page, _extractedAt, _hash',
      recipes: 'id, name, urlPattern, createdAt',
      history: 'id, datasetId, jobId, recipeId, status, startedAt, finishedAt',
      projects: 'id, name, status, createdAt, updatedAt',
      jobs: 'id, projectId, status, startedAt, finishedAt',
      schemas: 'id, name, urlPattern, createdAt, updatedAt',
      settings: 'id, updatedAt',
    });
    return legacy;
  }

  it('upgrades version 2 data to version 3 without losing anything', async () => {
    const dbName = name();
    const legacy = openV2(dbName);
    await legacy.open();
    await legacy.table('projects').put({ id: 'p1', name: 'Kept', status: 'configured', createdAt: 1, updatedAt: 1 });
    await legacy.table('datasets').put({
      id: 'd1',
      name: 'Kept dataset',
      url: 'https://x.test',
      recordsCount: 3,
      fields: [],
      createdAt: 1,
      updatedAt: 1,
    });
    await legacy.table('records').bulkPut([
      { _id: 'rec_ff_9_2', datasetId: 'd1', _page: 1, _extractedAt: 9, position: 2 },
      { _id: 'rec_aa_9_0', datasetId: 'd1', _page: 1, _extractedAt: 9, position: 0 },
      { _id: 'rec_bb_9_1', datasetId: 'd1', _page: 1, _extractedAt: 9, position: 1 },
    ]);
    await legacy.table('jobs').put({
      id: 'j1',
      projectId: 'p1',
      targetUrl: 'https://x.test',
      schema: makeRecipe(),
      status: 'completed',
      totalExtracted: 3,
      duplicatesSkipped: 0,
      pagesVisited: 1,
      startedAt: 1,
    });
    await legacy.table('jobs').put({
      id: 'j2',
      projectId: 'p1',
      targetUrl: 'https://x.test',
      schema: makeRecipe(),
      status: 'running',
      totalExtracted: 0,
      duplicatesSkipped: 0,
      pagesVisited: 0,
      startedAt: 2,
    });
    await legacy.table('history').put({
      id: 'h1',
      datasetId: 'd1',
      status: 'ERROR',
      totalExtracted: 1,
      duplicatesSkipped: 0,
      startedAt: 1,
    });
    await legacy.table('settings').put({ id: 'current', csvDelimiter: ';', theme: 'dark', updatedAt: 1 });
    legacy.close();

    const upgraded = new PageHarvestDB(dbName);
    await upgraded.open();

    expect(upgraded.verno).toBe(3);
    expect((await upgraded.projects.get('p1'))?.name).toBe('Kept');
    expect((await upgraded.datasets.get('d1'))?.name).toBe('Kept dataset');

    const rows = await upgraded.getDatasetRecords('d1');
    expect(rows.map((row) => row.position)).toEqual([0, 1, 2]);
    expect(rows.every((row) => typeof row._order === 'number')).toBe(true);

    const completed = await upgraded.jobs.get('j1');
    expect(completed?.status).toBe('COMPLETED');
    expect(ExtractionJobSchema.safeParse(completed).success).toBe(true);
    // No checkpoint exists for it, so an old running job is not offered for recovery.
    expect((await upgraded.jobs.get('j2'))?.status).toBe('FAILED');
    expect(await upgraded.jobs.where('status').equals('RECOVERABLE').count()).toBe(0);

    expect((await upgraded.history.get('h1'))?.status).toBe('FAILED');
    expect((await upgraded.settings.get('current'))?.csvDelimiter).toBe(';');
    expect(await upgraded.settings.get('current')).not.toHaveProperty('theme');

    upgraded.close();
    await upgraded.delete();
  });

  it('lets an upgraded dataset be indexed by content hash', async () => {
    const dbName = name();
    const legacy = openV2(dbName);
    await legacy.open();
    await legacy.table('records').put({ _id: 'r1', datasetId: 'd1', _page: 1, _extractedAt: 1, _hash: 'h1' });
    legacy.close();

    const upgraded = new PageHarvestDB(dbName);
    await upgraded.open();

    expect(await upgraded.records.where('[datasetId+_hash]').equals(['d1', 'h1']).count()).toBe(1);

    upgraded.close();
    await upgraded.delete();
  });
});

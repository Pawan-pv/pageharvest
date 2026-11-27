import { describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { MIN_PAGE_DELAY_MS, PaginationConfigSchema } from '@/shared/contracts/pagination';
import { UserSettingsSchema } from '@/shared/contracts/settings';
import { PageHarvestDB } from '@/storage/db';

/**
 * The wait between pages is at least one second (ADR-046): gentler on the sites a job visits.
 * Values stored by earlier versions, which allowed 200 ms, are raised to the new minimum
 * when the database opens, so nothing stored stops parsing.
 */
describe('The minimum wait between pages', () => {
  it('is 1000 ms in the pagination contract and the settings', () => {
    expect(MIN_PAGE_DELAY_MS).toBe(1000);
    expect(PaginationConfigSchema.safeParse({ delayMs: 999 }).success).toBe(false);
    expect(PaginationConfigSchema.safeParse({ delayMs: 1000 }).success).toBe(true);
    expect(UserSettingsSchema.safeParse({ defaultDelayMs: 999 }).success).toBe(false);
    expect(UserSettingsSchema.safeParse({ defaultDelayMs: 1000 }).success).toBe(true);
  });

  it('keeps the defaults above it', () => {
    expect(PaginationConfigSchema.parse({}).delayMs).toBeGreaterThanOrEqual(MIN_PAGE_DELAY_MS);
    expect(UserSettingsSchema.parse({}).defaultDelayMs).toBeGreaterThanOrEqual(MIN_PAGE_DELAY_MS);
  });
});

describe('Upgrading stored data to the one-second minimum', () => {
  const pagination = (delayMs: number) => ({
    type: 'next_button',
    maxPages: 5,
    delayMs,
    scrollCount: 30,
    scrollDelayMs: 1500,
    startPage: 1,
    pageIncrement: 1,
    stopCondition: 'no_new_records',
  });

  async function openVersion3(name: string) {
    const legacy = new Dexie(name);
    legacy.version(3).stores({
      datasets: 'id, name, url, projectId, jobId, createdAt, updatedAt',
      records: '_id, datasetId, _jobId, _projectId, _page, _extractedAt, _hash, [datasetId+_hash]',
      recipes: 'id, name, urlPattern, schemaId, projectId, createdAt, updatedAt',
      history: 'id, datasetId, jobId, projectId, recipeId, status, startedAt, finishedAt',
      projects: 'id, name, status, createdAt, updatedAt',
      jobs: 'id, projectId, datasetId, status, tabId, startedAt, finishedAt',
      schemas: 'id, name, urlPattern, projectId, createdAt, updatedAt',
      settings: 'id, updatedAt',
      checkpoints: 'jobId, tabId, updatedAt, expiresAt',
    });
    await legacy.open();
    return legacy;
  }

  it('raises every stored wait below one second to one second, and leaves the rest alone', async () => {
    const name = `MinWaitDB_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const legacy = await openVersion3(name);
    await legacy.table('settings').put({ id: 'current', defaultDelayMs: 200, defaultMaxPages: 20, updatedAt: 1 });
    await legacy.table('recipes').bulkPut([
      { id: 'r_fast', name: 'Fast', urlPattern: '*', containerSelector: '.c', fields: [], pagination: pagination(500), createdAt: 1, updatedAt: 1 },
      { id: 'r_slow', name: 'Slow', urlPattern: '*', containerSelector: '.c', fields: [], pagination: pagination(4000), createdAt: 1, updatedAt: 1 },
    ]);
    await legacy.table('schemas').put({
      id: 's_fast', name: 'Fast', urlPattern: '*', containerSelector: '.c', fields: [], pagination: pagination(300), version: 1, createdAt: 1, updatedAt: 1,
    });
    await legacy.table('jobs').put({
      id: 'j_fast', targetUrl: 'https://shop.test/list', status: 'RECOVERABLE', schema: { pagination: pagination(200) }, startedAt: 1,
    });
    await legacy.table('records').put({ _id: 'kept', datasetId: 'd1', Title: 'Kept' });
    legacy.close();

    const upgraded = new PageHarvestDB(name);
    await upgraded.open();

    expect(upgraded.verno).toBe(4);
    expect((await upgraded.settings.get('current'))?.defaultDelayMs).toBe(1000);
    expect((await upgraded.recipes.get('r_fast'))?.pagination?.delayMs).toBe(1000);
    expect((await upgraded.recipes.get('r_slow'))?.pagination?.delayMs).toBe(4000);
    expect((await upgraded.schemas.get('s_fast'))?.pagination.delayMs).toBe(1000);
    expect((await upgraded.jobs.get('j_fast'))?.schema.pagination.delayMs).toBe(1000);
    expect((await upgraded.records.get('kept'))?.Title).toBe('Kept');
    upgraded.close();
    await upgraded.delete();
  });
});

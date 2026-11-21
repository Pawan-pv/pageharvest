import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PageHarvestDB } from '@/storage/db';
import { installBackground, uniqueDb } from '../utils/job-harness';

const TAB = 77;
const DATASET_ID = 'ds_data_commands';
const envelope = { id: 'data_1', timestamp: 1 };

function fromPanel(message: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, resolve);
  });
}

/**
 * The side panel may read IndexedDB for display, but every write goes through the
 * background. These commands are the panel's only write path for grid edits and
 * clearing saved data.
 */
describe('Data commands from the side panel', () => {
  let db: PageHarvestDB;

  beforeEach(async () => {
    db = uniqueDb();
    installBackground(db);
    await db.datasets.put({
      id: DATASET_ID,
      name: 'Editable list',
      url: 'https://example.com/list',
      recordsCount: 2,
      fields: [{ id: 'name', name: 'Name', selector: '.name', extractor: 'text' }],
      createdAt: 1,
      updatedAt: 1,
    });
    await db.records.bulkPut([
      { _id: 'r1', _page: 1, _extractedAt: 1, _order: 1, datasetId: DATASET_ID, Name: 'One' },
      { _id: 'r2', _page: 1, _extractedAt: 1, _order: 2, datasetId: DATASET_ID, Name: 'Two' },
    ]);
  });

  afterEach(async () => {
    db.close();
    await db.delete();
  });

  it('updates one cell through the background', async () => {
    const reply = await fromPanel({
      ...envelope,
      type: 'UPDATE_RECORD_CELL',
      payload: { recordId: 'r1', field: 'Name', value: 'Uno' },
    });

    expect(reply).toEqual({ ok: true });
    expect((await db.records.get('r1'))?.Name).toBe('Uno');
  });

  it('deletes rows and keeps the saved row count in step', async () => {
    const reply = await fromPanel({
      ...envelope,
      type: 'DELETE_RECORDS',
      payload: { datasetId: DATASET_ID, recordIds: ['r1', 'r2'] },
    });

    expect(reply).toEqual({ ok: true, deleted: 2 });
    expect(await db.records.where('datasetId').equals(DATASET_ID).count()).toBe(0);
    expect((await db.datasets.get(DATASET_ID))?.recordsCount).toBe(0);
  });

  it('applies a dataset edit, including a column rename, as one background transaction', async () => {
    const reply = await fromPanel({
      ...envelope,
      type: 'APPLY_DATASET_EDIT',
      payload: {
        datasetId: DATASET_ID,
        records: [{ _id: 'r1', _page: 1, _extractedAt: 1, _order: 1, Name: 'One', Price: 5 }],
        fields: [
          { id: 'name', name: 'Name', selector: '.name', extractor: 'text' },
          { id: 'price', name: 'Price', selector: '.price', extractor: 'number' },
        ],
      },
    });

    expect(reply).toEqual({ ok: true });
    expect(await db.records.where('datasetId').equals(DATASET_ID).count()).toBe(1);
    expect((await db.records.get('r2'))).toBeUndefined();
    expect((await db.datasets.get(DATASET_ID))?.fields.map((field) => field.name)).toEqual([
      'Name',
      'Price',
    ]);
  });

  it('clears saved data while keeping preferences', async () => {
    await db.settings.put({
      id: 'settings',
      schemaVersion: 2,
      defaultDelayMs: 1500,
      defaultMaxPages: 20,
      defaultMaxScrolls: 30,
      defaultScrollDelayMs: 1500,
      defaultExportFormat: 'csv',
      csvDelimiter: ',',
      csvIncludeBom: true,
      jsonIndent: 2,
      retentionDays: 30,
      maxRecordsWarningThreshold: 5000,
      updatedAt: 1,
    });

    const reply = await fromPanel({ ...envelope, type: 'CLEAR_USER_DATA', payload: {} });

    expect(reply).toEqual({ ok: true });
    expect(await db.datasets.count()).toBe(0);
    expect(await db.records.count()).toBe(0);
    expect(await db.settings.count()).toBe(1);
  });

  it('refuses a data command from a content script', async () => {
    const reply = await chromeMock.sendFromContentScript(TAB, {
      ...envelope,
      type: 'UPDATE_RECORD_CELL',
      payload: { recordId: 'r1', field: 'Name', value: 'Forged' },
    });

    expect(reply).toMatchObject({ ok: false });
    expect((await db.records.get('r1'))?.Name).toBe('One');
  });

  it('rejects a malformed cell value before it reaches the database', async () => {
    const reply = (await fromPanel({
      ...envelope,
      type: 'UPDATE_RECORD_CELL',
      payload: { recordId: 'r1', field: 'Name', value: { nested: true } },
    })) as { ok: boolean; error: string };

    expect(reply.ok).toBe(false);
    expect(reply.error).toMatch(/INVALID_MESSAGE/);
    expect((await db.records.get('r1'))?.Name).toBe('One');
  });
});

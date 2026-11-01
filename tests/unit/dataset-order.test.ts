import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PageHarvestDB } from '@/storage/db';

describe('Saved dataset row order', () => {
  let db: PageHarvestDB;

  beforeEach(() => {
    db = new PageHarvestDB(`OrderTestDB_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  });

  afterEach(async () => {
    await db.delete();
  });

  it('reads rows sharing a timestamp back in extraction order', async () => {
    const extractedAt = 1_700_000_000_000;
    const hashes = ['f3a1', '02bc', '9d11', '5e77', 'c044', '1aa9'];
    await db.datasets.put({
      id: 'ds',
      name: 'Order',
      url: 'https://example.com',
      recordsCount: 0,
      fields: [],
      createdAt: 1,
      updatedAt: 1,
    });
    await db.saveExtractedBatch(
      'ds',
      hashes.map((hash, index) => ({
        _id: `rec_${hash}_${extractedAt}_${index}`,
        _page: 1,
        _extractedAt: extractedAt,
        datasetId: 'ds',
        position: index,
      }))
    );

    const rows = await db.getDatasetRecords('ds');

    expect(rows.map((row) => row.position)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('orders by explicit sequence across pages even when timestamps disagree', async () => {
    await db.records.bulkPut([
      { _id: 'c', _page: 2, _extractedAt: 100, _order: 2_000_000, datasetId: 'ds', position: 2 },
      { _id: 'a', _page: 1, _extractedAt: 300, _order: 1_000_000, datasetId: 'ds', position: 0 },
      { _id: 'b', _page: 1, _extractedAt: 200, _order: 1_000_001, datasetId: 'ds', position: 1 },
    ]);

    const rows = await db.getDatasetRecords('ds');

    expect(rows.map((row) => row.position)).toEqual([0, 1, 2]);
  });
});

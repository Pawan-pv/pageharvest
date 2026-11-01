import { PageHarvestDB, db as defaultDb } from '../db';
import { RecordEntity } from '@/types';

export interface RecordQueryOptions {
  datasetId?: string;
  projectId?: string;
  jobId?: string;
  offset?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export class RecordRepository {
  constructor(private db: PageHarvestDB = defaultDb) {}

  public async insertBatch(records: RecordEntity[]): Promise<number> {
    if (records.length === 0) return 0;
    await this.db.records.bulkPut(records);
    return records.length;
  }

  public async getRecord(id: string): Promise<RecordEntity | undefined> {
    return this.db.records.get(id);
  }

  public async getRecords(
    options: RecordQueryOptions = {}
  ): Promise<{ records: RecordEntity[]; total: number }> {
    let collection: Dexie.Collection<RecordEntity, string>;

    if (options.datasetId) {
      collection = this.db.records.where('datasetId').equals(options.datasetId);
    } else if (options.projectId) {
      collection = this.db.records.where('_projectId').equals(options.projectId);
    } else if (options.jobId) {
      collection = this.db.records.where('_jobId').equals(options.jobId);
    } else {
      collection = this.db.records.toCollection();
    }

    const total = await collection.count();

    let items = await collection.toArray();

    // In-memory sorting if custom field requested
    if (options.sortBy) {
      const field = options.sortBy;
      const order = options.sortOrder === 'desc' ? -1 : 1;
      items.sort((a, b) => {
        const valA = a[field];
        const valB = b[field];
        if (valA === valB) return 0;
        if (valA === undefined || valA === null) return 1;
        if (valB === undefined || valB === null) return -1;
        if (typeof valA === 'number' && typeof valB === 'number') {
          return (valA - valB) * order;
        }
        return String(valA).localeCompare(String(valB)) * order;
      });
    } else {
      // Default sort by extraction time asc
      items.sort((a, b) => (a._extractedAt || 0) - (b._extractedAt || 0));
    }

    // Apply offset and limit
    const offset = options.offset || 0;
    const limit = options.limit !== undefined ? options.limit : items.length;
    const sliced = items.slice(offset, offset + limit);

    return { records: sliced, total };
  }

  public async updateCell(
    recordId: string,
    field: string,
    value: string | number | boolean | null | undefined
  ): Promise<void> {
    await this.db.records.update(recordId, {
      [field]: value,
    });
  }

  public async deleteRecord(recordId: string, datasetId?: string): Promise<void> {
    await this.db.transaction('rw', [this.db.records, this.db.datasets], async () => {
      await this.db.records.delete(recordId);
      if (datasetId) {
        const remaining = await this.db.records.where('datasetId').equals(datasetId).count();
        await this.db.datasets.update(datasetId, {
          recordsCount: remaining,
          updatedAt: Date.now(),
        });
      }
    });
  }

  public async deleteBatch(recordIds: string[], datasetId?: string): Promise<number> {
    if (recordIds.length === 0) return 0;

    await this.db.transaction('rw', [this.db.records, this.db.datasets], async () => {
      await this.db.records.bulkDelete(recordIds);
      if (datasetId) {
        const remaining = await this.db.records.where('datasetId').equals(datasetId).count();
        await this.db.datasets.update(datasetId, {
          recordsCount: remaining,
          updatedAt: Date.now(),
        });
      }
    });

    return recordIds.length;
  }

  public async replaceDatasetRecords(
    datasetId: string,
    newRecords: RecordEntity[]
  ): Promise<void> {
    await this.db.transaction('rw', [this.db.records, this.db.datasets], async () => {
      // Delete old records for this dataset
      await this.db.records.where('datasetId').equals(datasetId).delete();
      // Insert new records
      const recordsToPut = newRecords.map((r) => ({
        ...r,
        datasetId,
      }));
      await this.db.records.bulkPut(recordsToPut);
      // Update dataset count
      await this.db.datasets.update(datasetId, {
        recordsCount: recordsToPut.length,
        updatedAt: Date.now(),
      });
    });
  }
}

import { PageHarvestDB, db as defaultDb } from '../db';
import { DatasetEntity, FieldDefinition, RecordEntity } from '@/types';

export class DatasetRepository {
  constructor(private db: PageHarvestDB = defaultDb) {}

  public async createDataset(dataset: DatasetEntity): Promise<string> {
    await this.db.datasets.add(dataset);
    return dataset.id;
  }

  public async getDataset(id: string): Promise<DatasetEntity | undefined> {
    return this.db.datasets.get(id);
  }

  public async getAllDatasets(): Promise<DatasetEntity[]> {
    return this.db.datasets.orderBy('createdAt').reverse().toArray();
  }

  public async addRecords(datasetId: string, records: RecordEntity[]): Promise<void> {
    await this.db.saveExtractedBatch(datasetId, records);
  }

  public async getRecordsByDataset(
    datasetId: string,
    limit?: number,
    offset: number = 0
  ): Promise<RecordEntity[]> {
    const records = await this.db.getDatasetRecords(datasetId);
    return records.slice(offset, limit !== undefined ? offset + limit : undefined);
  }

  /**
   * Replaces a dataset's rows and columns as one transaction. Rows absent from
   * `records` are deleted, so this covers cleaning, renames and bulk deletes.
   * If the transaction fails nothing changes and the promise rejects.
   */
  public async applyEdit(
    datasetId: string,
    records: RecordEntity[],
    fields: FieldDefinition[]
  ): Promise<void> {
    await this.db.transaction('rw', this.db.datasets, this.db.records, async () => {
      const keptIds = new Set(records.map((record) => record._id));
      const existingIds = await this.db.records.where('datasetId').equals(datasetId).primaryKeys();
      await this.db.records.bulkDelete(existingIds.filter((id) => !keptIds.has(id)));
      await this.db.records.bulkPut(records.map((record) => ({ ...record, datasetId })));
      await this.db.datasets.update(datasetId, {
        fields,
        recordsCount: records.length,
        updatedAt: Date.now(),
      });
    });
  }

  public async deleteDataset(id: string): Promise<void> {
    await this.db.deleteDatasetWithRecords(id);
  }
}

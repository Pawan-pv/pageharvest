import { PageHarvestDB, db as defaultDb } from '../db';
import { DatasetEntity, RecordEntity } from '@/types';

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
    await this.db.transaction('rw', [this.db.datasets, this.db.records], async () => {
      await this.db.records.bulkPut(records);
      const dataset = await this.db.datasets.get(datasetId);
      if (dataset) {
        dataset.recordsCount = await this.db.records.where('datasetId').equals(datasetId).count();
        dataset.updatedAt = Date.now();
        await this.db.datasets.put(dataset);
      }
    });
  }

  public async getRecordsByDataset(
    datasetId: string,
    limit?: number,
    offset: number = 0
  ): Promise<RecordEntity[]> {
    let collection = this.db.records.where('datasetId').equals(datasetId);
    if (offset > 0) {
      collection = collection.offset(offset);
    }
    if (limit !== undefined) {
      collection = collection.limit(limit);
    }
    return collection.toArray();
  }

  public async deleteDataset(id: string): Promise<void> {
    await this.db.transaction('rw', [this.db.datasets, this.db.records], async () => {
      await this.db.records.where('datasetId').equals(id).delete();
      await this.db.datasets.delete(id);
    });
  }
}

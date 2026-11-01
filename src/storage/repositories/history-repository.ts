import { PageHarvestDB, db as defaultDb } from '../db';
import { ExtractionRunHistory } from '@/types';

export class HistoryRepository {
  constructor(private db: PageHarvestDB = defaultDb) {}

  public async recordRun(history: ExtractionRunHistory): Promise<string> {
    await this.db.history.put(history);
    return history.id;
  }

  public async getRun(id: string): Promise<ExtractionRunHistory | undefined> {
    return this.db.history.get(id);
  }

  public async getHistoryByDataset(datasetId: string): Promise<ExtractionRunHistory[]> {
    return this.db.history.where('datasetId').equals(datasetId).reverse().sortBy('startedAt');
  }

  public async getAllHistory(): Promise<ExtractionRunHistory[]> {
    return this.db.history.orderBy('startedAt').reverse().toArray();
  }

  public async deleteRun(id: string): Promise<void> {
    await this.db.history.delete(id);
  }

  public async clearAllHistory(): Promise<void> {
    await this.db.history.clear();
  }
}

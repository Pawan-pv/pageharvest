import { PageHarvestDB, db as defaultDb } from '../db';
import { ExtractionJob, JobStatus } from '@/shared/contracts/job';

export class JobRepository {
  constructor(private db: PageHarvestDB = defaultDb) {}

  public async createJob(job: ExtractionJob): Promise<string> {
    await this.db.jobs.put(job);
    return job.id;
  }

  public async getJob(id: string): Promise<ExtractionJob | undefined> {
    return this.db.jobs.get(id);
  }

  public async getAllJobs(projectId?: string): Promise<ExtractionJob[]> {
    if (projectId) {
      return this.db.jobs.where('projectId').equals(projectId).reverse().sortBy('startedAt');
    }
    return this.db.jobs.orderBy('startedAt').reverse().toArray();
  }

  public async updateJobStatus(
    id: string,
    status: JobStatus,
    updates: Partial<ExtractionJob> = {}
  ): Promise<void> {
    const finalUpdates: Partial<ExtractionJob> = {
      ...updates,
      status,
    };
    if (status === 'completed' || status === 'failed' || status === 'stopped') {
      if (!finalUpdates.finishedAt) {
        finalUpdates.finishedAt = Date.now();
      }
    }
    await this.db.jobs.update(id, finalUpdates);
  }

  public async deleteJob(id: string): Promise<void> {
    await this.db.jobs.delete(id);
  }
}

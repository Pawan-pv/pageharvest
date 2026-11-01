import { PageHarvestDB, db as defaultDb } from '../db';
import {
  ACTIVE_JOB_STATUSES,
  ExtractionJob,
  JobCheckpoint,
  JobStatus,
  isTerminalJobStatus,
} from '@/shared/contracts/job';

export class JobRepository {
  constructor(private db: PageHarvestDB = defaultDb) {}

  public async createJob(job: ExtractionJob): Promise<string> {
    await this.db.jobs.put(job);
    return job.id;
  }

  public async saveJob(job: ExtractionJob): Promise<void> {
    await this.db.jobs.put(job);
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
      updatedAt: Date.now(),
    };
    if (isTerminalJobStatus(status) && !finalUpdates.finishedAt) {
      finalUpdates.finishedAt = Date.now();
    }
    await this.db.jobs.update(id, finalUpdates);
  }

  public async deleteJob(id: string): Promise<void> {
    await this.db.transaction('rw', this.db.jobs, this.db.checkpoints, async () => {
      await this.db.checkpoints.delete(id);
      await this.db.jobs.delete(id);
    });
  }

  /** Jobs currently executing or paused, newest first. */
  public async findActiveJobs(): Promise<ExtractionJob[]> {
    const jobs = await this.db.jobs.where('status').anyOf([...ACTIVE_JOB_STATUSES]).toArray();
    return jobs.sort((a, b) => b.startedAt - a.startedAt);
  }

  public async findActiveJobForTab(tabId: number): Promise<ExtractionJob | undefined> {
    const jobs = await this.findActiveJobs();
    return jobs.find((job) => job.tabId === tabId);
  }

  /** Jobs the user can still resume or discard, newest first. */
  public async findRecoverableJobs(): Promise<ExtractionJob[]> {
    const jobs = await this.db.jobs.where('status').equals('RECOVERABLE').toArray();
    return jobs.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  public async getCheckpoint(jobId: string): Promise<JobCheckpoint | undefined> {
    return this.db.checkpoints.get(jobId);
  }

  public async saveCheckpoint(checkpoint: JobCheckpoint): Promise<void> {
    await this.db.checkpoints.put(checkpoint);
  }

  public async deleteCheckpoint(jobId: string): Promise<void> {
    await this.db.checkpoints.delete(jobId);
  }

  public async listCheckpoints(): Promise<JobCheckpoint[]> {
    return this.db.checkpoints.toArray();
  }
}

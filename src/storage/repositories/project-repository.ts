import { PageHarvestDB, db as defaultDb } from '../db';
import { ExtractionProject } from '@/shared/contracts/project';
import { ACTIVE_JOB_STATUSES } from '@/shared/contracts/job';

export interface ProjectUsage {
  datasets: number;
  records: number;
  jobs: number;
  activeJobs: number;
}

export class ProjectRepository {
  constructor(private db: PageHarvestDB = defaultDb) {}

  public async createProject(project: ExtractionProject): Promise<string> {
    await this.db.projects.put(project);
    return project.id;
  }

  public async getProject(id: string): Promise<ExtractionProject | undefined> {
    return this.db.projects.get(id);
  }

  public async getAllProjects(): Promise<ExtractionProject[]> {
    return this.db.projects.orderBy('updatedAt').reverse().toArray();
  }

  /** Finds the project with this exact name, or creates it. Used to group jobs by site. */
  public async findOrCreateByName(
    name: string,
    targetUrl: string,
    now: number = Date.now()
  ): Promise<ExtractionProject> {
    const existing = await this.db.projects.where('name').equals(name).first();
    if (existing) return existing;

    const project: ExtractionProject = {
      id: `project_${now}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      targetUrl,
      status: 'configured',
      tags: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.db.projects.put(project);
    return project;
  }

  public async updateProject(id: string, updates: Partial<ExtractionProject>): Promise<void> {
    const existing = await this.db.projects.get(id);
    if (!existing) {
      throw new Error(`Project ${id} not found`);
    }
    await this.db.projects.update(id, {
      ...updates,
      updatedAt: Date.now(),
    });
  }

  public async getUsage(id: string): Promise<ProjectUsage> {
    const [datasets, records, jobs] = await Promise.all([
      this.db.datasets.where('projectId').equals(id).count(),
      this.db.records.where('_projectId').equals(id).count(),
      this.db.jobs.where('projectId').equals(id).toArray(),
    ]);
    return {
      datasets,
      records,
      jobs: jobs.length,
      activeJobs: jobs.filter((job) => ACTIVE_JOB_STATUSES.includes(job.status)).length,
    };
  }

  /**
   * Deletes a project and everything it owns in one transaction, leaving no orphaned
   * rows. Saved schemas and recipes outlive the project but lose the association.
   * Refuses while a job of the project is still executing.
   */
  public async deleteProject(id: string, cascade: boolean = true): Promise<void> {
    if (!cascade) {
      await this.db.projects.delete(id);
      return;
    }

    await this.db.transaction(
      'rw',
      [
        this.db.projects,
        this.db.jobs,
        this.db.checkpoints,
        this.db.records,
        this.db.datasets,
        this.db.history,
        this.db.schemas,
        this.db.recipes,
      ],
      async () => {
        const jobs = await this.db.jobs.where('projectId').equals(id).toArray();
        if (jobs.some((job) => ACTIVE_JOB_STATUSES.includes(job.status))) {
          throw new Error('This project has an extraction running. Stop it before deleting the project.');
        }

        await this.db.checkpoints.bulkDelete(jobs.map((job) => job.id));
        await this.db.jobs.where('projectId').equals(id).delete();
        await this.db.records.where('_projectId').equals(id).delete();
        const datasets = await this.db.datasets.where('projectId').equals(id).primaryKeys();
        await this.db.records.where('datasetId').anyOf(datasets).delete();
        await this.db.datasets.bulkDelete(datasets);
        await this.db.history.where('projectId').equals(id).delete();
        await this.db.schemas.where('projectId').equals(id).modify({ projectId: undefined });
        await this.db.recipes.where('projectId').equals(id).modify({ projectId: undefined });
        await this.db.projects.delete(id);
      }
    );
  }
}

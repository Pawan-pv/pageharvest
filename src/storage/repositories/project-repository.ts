import { PageHarvestDB, db as defaultDb } from '../db';
import { ExtractionProject } from '@/shared/contracts/project';

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

  public async deleteProject(id: string, cascade: boolean = true): Promise<void> {
    if (cascade) {
      await this.db.transaction('rw', [this.db.projects, this.db.jobs, this.db.records], async () => {
        // Cascade delete records associated with this project
        await this.db.records.where('_projectId').equals(id).delete();
        // Delete jobs associated with this project
        await this.db.jobs.where('projectId').equals(id).delete();
        // Delete project itself
        await this.db.projects.delete(id);
      });
    } else {
      await this.db.projects.delete(id);
    }
  }
}

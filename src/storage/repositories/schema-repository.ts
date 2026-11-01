import { PageHarvestDB, db as defaultDb } from '../db';
import { ExtractionSchema } from '@/shared/contracts/schema';

export class SchemaRepository {
  constructor(private db: PageHarvestDB = defaultDb) {}

  public async createSchema(schema: ExtractionSchema): Promise<string> {
    await this.db.schemas.put(schema);
    return schema.id;
  }

  public async getSchema(id: string): Promise<ExtractionSchema | undefined> {
    return this.db.schemas.get(id);
  }

  public async getAllSchemas(): Promise<ExtractionSchema[]> {
    return this.db.schemas.orderBy('updatedAt').reverse().toArray();
  }

  public async updateSchema(id: string, updates: Partial<ExtractionSchema>): Promise<void> {
    await this.db.schemas.update(id, {
      ...updates,
      updatedAt: Date.now(),
    });
  }

  public async deleteSchema(id: string): Promise<void> {
    await this.db.schemas.delete(id);
  }

  public async findMatchingSchema(url: string): Promise<ExtractionSchema | undefined> {
    const schemas = await this.getAllSchemas();
    return schemas.find((s) => {
      if (!s.urlPattern) return false;
      const regexStr = '^' + s.urlPattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$';
      try {
        return new RegExp(regexStr).test(url);
      } catch {
        return false;
      }
    });
  }
}

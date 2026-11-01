import { PageHarvestDB, db as defaultDb } from '../db';
import { ExtractionRecipe } from '@/types';

export class RecipeRepository {
  constructor(private db: PageHarvestDB = defaultDb) {}

  public async saveRecipe(recipe: ExtractionRecipe): Promise<string> {
    await this.db.recipes.put(recipe);
    return recipe.id;
  }

  public async getRecipe(id: string): Promise<ExtractionRecipe | undefined> {
    return this.db.recipes.get(id);
  }

  public async getAllRecipes(): Promise<ExtractionRecipe[]> {
    return this.db.recipes.orderBy('createdAt').reverse().toArray();
  }

  public async updateRecipe(id: string, updates: Partial<ExtractionRecipe>): Promise<void> {
    const changed = await this.db.recipes.update(id, { ...updates, updatedAt: Date.now() });
    if (changed === 0) {
      throw new Error(`Recipe ${id} no longer exists.`);
    }
  }

  public async deleteRecipe(id: string): Promise<void> {
    await this.db.recipes.delete(id);
  }

  public async findRecipeForUrl(url: string): Promise<ExtractionRecipe | undefined> {
    const all = await this.getAllRecipes();
    return all.find((r) => {
      if (!r.urlPattern) return false;
      const regexStr = '^' + r.urlPattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$';
      try {
        return new RegExp(regexStr).test(url);
      } catch {
        return false;
      }
    });
  }
}

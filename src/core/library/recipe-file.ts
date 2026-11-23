import {
  RECIPE_FILE_KIND,
  RECIPE_FILE_VERSION,
  RecipeFileSchema,
  type RecipeFile,
} from '@/shared/contracts/recipe-file';
import { ExtractionSchema, ExtractionSchemaSchema } from '@/shared/contracts/schema';
import type { ExtractionRecipe } from '@/types';

/** A file name a person recognises, without characters a file system refuses. */
export function recipeFileName(recipe: Pick<ExtractionRecipe, 'name'>): string {
  const slug = recipe.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'pageharvest-recipe'}.pageharvest-recipe.json`;
}

/**
 * A saved recipe in the canonical extraction-schema shape. Parsing fills the defaults the
 * schema contract requires, so an exported file always imports again on a later version.
 */
export function recipeToSchema(recipe: ExtractionRecipe): ExtractionSchema {
  return ExtractionSchemaSchema.parse({
    id: recipe.id,
    name: recipe.name,
    description: recipe.description,
    projectId: recipe.projectId,
    urlPattern: recipe.urlPattern,
    containerSelector: recipe.containerSelector,
    containerAnchor: recipe.containerAnchor,
    fields: recipe.fields,
    pagination: recipe.pagination,
    dedupeFields: recipe.dedupeFields,
    version: 1,
    createdAt: recipe.createdAt,
    updatedAt: recipe.updatedAt,
  });
}

/** The legacy workspace recipe stored in IndexedDB, built from a validated schema. */
export function schemaToRecipe(schema: ExtractionSchema): ExtractionRecipe {
  return {
    id: schema.id,
    name: schema.name,
    description: schema.description,
    projectId: schema.projectId,
    urlPattern: schema.urlPattern,
    containerSelector: schema.containerSelector,
    containerAnchor: schema.containerAnchor,
    fields: schema.fields,
    pagination: schema.pagination,
    dedupeFields: schema.dedupeFields,
    createdAt: schema.createdAt,
    updatedAt: schema.updatedAt,
  };
}

export function serializeRecipeFile(recipe: ExtractionRecipe, now: number = Date.now()): string {
  const file: RecipeFile = {
    kind: RECIPE_FILE_KIND,
    version: RECIPE_FILE_VERSION,
    exportedAt: now,
    recipe: recipeToSchema(recipe),
  };
  return JSON.stringify(file, null, 2);
}

function describeIssues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.map(String).join('.') || 'recipe'}: ${issue.message}`)
    .join('; ');
}

/**
 * Reads a .pageharvest-recipe.json file. The envelope and every field are validated before
 * the recipe reaches storage; an invalid file is refused with the reason, never half-saved.
 */
export function parseRecipeFile(text: string): ExtractionRecipe {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }

  const parsed = RecipeFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`This is not a PageHarvest recipe file. ${describeIssues(parsed.error)}`);
  }

  return schemaToRecipe(parsed.data.recipe);
}

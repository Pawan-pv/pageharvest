import { z } from 'zod';
import { ExtractionSchemaSchema } from './schema';

/**
 * A recipe file is a single recipe plus the envelope that says what it is. The envelope
 * makes an imported file checkable before anything is stored: a JSON document that is not
 * a PageHarvest recipe is refused with a reason instead of being written as a broken row.
 */
export const RECIPE_FILE_KIND = 'pageharvest-recipe';
export const RECIPE_FILE_VERSION = 1;

export const RecipeFileSchema = z.object({
  kind: z.literal(RECIPE_FILE_KIND),
  version: z.literal(RECIPE_FILE_VERSION),
  exportedAt: z.number().int().min(0),
  recipe: ExtractionSchemaSchema,
});

export type RecipeFile = z.infer<typeof RecipeFileSchema>;

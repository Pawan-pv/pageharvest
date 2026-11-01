import { z } from 'zod';
import { ExtractionSchemaSchema } from './schema';

/**
 * Project configuration status.
 */
export const ProjectStatusSchema = z.enum([
  'draft',        // Under configuration in side panel
  'configured',   // Ready for extraction execution
  'archived',     // Saved historical project
]);

export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

/**
 * Canonical ExtractionProject contract.
 * Represents a user-managed scraping project/recipe.
 */
export const ExtractionProjectSchema = z.object({
  id: z.string().min(1, 'Project ID is required'),
  name: z.string().min(1, 'Project name is required'),
  description: z.string().optional(),
  targetUrl: z.string().url('A valid URL is required'),
  schema: ExtractionSchemaSchema,
  status: ProjectStatusSchema.default('draft'),
  tags: z.array(z.string()).default([]).optional(),
  createdAt: z.number().int().default(() => Date.now()),
  updatedAt: z.number().int().default(() => Date.now()),
});

export type ExtractionProject = z.infer<typeof ExtractionProjectSchema>;

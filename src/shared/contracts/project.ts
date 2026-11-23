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
 * A project groups the datasets, jobs, schemas and recipes of one scraping effort.
 * The target URL and schema are optional because a project can exist before its
 * first extraction has been configured.
 */
export const ExtractionProjectSchema = z.object({
  id: z.string().min(1, 'Project ID is required'),
  name: z.string().min(1, 'Project name is required'),
  description: z.string().optional(),
  targetUrl: z.string().url('A valid URL is required').optional(),
  schema: ExtractionSchemaSchema.optional(),
  status: ProjectStatusSchema.default('draft'),
  // No .default([]): Zod 4 would add tags to every project that has none (ADR-035).
  tags: z.array(z.string()).optional(),
  createdAt: z.number().int().default(() => Date.now()),
  updatedAt: z.number().int().default(() => Date.now()),
});

export type ExtractionProject = z.infer<typeof ExtractionProjectSchema>;

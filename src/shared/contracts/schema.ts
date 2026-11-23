import { z } from 'zod';
import { ExtractionFieldSchema } from './field';
import { PaginationConfigSchema } from './pagination';
import { MultiAnchorSelectorSchema } from './selector';

/**
 * Canonical ExtractionSchema definition.
 * Governs the blueprint for extracting structured repeated records from a page.
 */
export const ExtractionSchemaSchema = z.object({
  id: z.string().min(1, 'Schema ID is required'),
  name: z.string().min(1, 'Schema name is required'),
  description: z.string().optional(),
  projectId: z.string().optional(),
  urlPattern: z.string().min(1, 'URL pattern or wildcard is required'),
  containerSelector: z.string().min(1, 'Container selector is required'),
  /** Multi-anchor fallback ladder for the repeating container. Optional for legacy recipes. */
  containerAnchor: MultiAnchorSelectorSchema.optional(),
  fields: z.array(ExtractionFieldSchema).min(1, 'At least one field is required'),
  // prefault, not default: the value is parsed, so the schema's own defaults fill the rest (ADR-035).
  pagination: PaginationConfigSchema.prefault({
    type: 'none',
    maxPages: 20,
    delayMs: 1500,
    scrollCount: 30,
    scrollDelayMs: 1500,
  }),
  // A run keeps one record per value of these fields, such as one record per link URL.
  dedupeFields: z.array(z.string()).optional(),
  version: z.number().int().min(1).default(1),
  createdAt: z.number().int().default(() => Date.now()),
  updatedAt: z.number().int().default(() => Date.now()),
});

export type ExtractionSchema = z.infer<typeof ExtractionSchemaSchema>;

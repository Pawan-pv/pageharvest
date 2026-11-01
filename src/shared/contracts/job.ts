import { z } from 'zod';
import { ExtractionSchemaSchema } from './schema';

/**
 * Extraction job lifecycle state.
 */
export const JobStatusSchema = z.enum([
  'queued',       // Waiting to start
  'running',      // Actively extracting
  'paused',       // Paused by user or rate limit
  'completed',    // Finished all pages/scrolls successfully
  'failed',       // Encountered fatal unrecoverable error
  'stopped',      // Stopped by user manual abort
]);

export type JobStatus = z.infer<typeof JobStatusSchema>;

/**
 * Canonical ExtractionJob contract.
 * Represents an execution run of an extraction schema.
 */
export const ExtractionJobSchema = z.object({
  id: z.string().min(1, 'Job ID is required'),
  projectId: z.string().optional(),
  targetUrl: z.string().url('Valid target URL is required'),
  schema: ExtractionSchemaSchema,
  status: JobStatusSchema.default('queued'),
  totalExtracted: z.number().int().min(0).default(0),
  duplicatesSkipped: z.number().int().min(0).default(0),
  pagesVisited: z.number().int().min(0).default(0),
  startedAt: z.number().int().default(() => Date.now()),
  finishedAt: z.number().int().optional(),
  errorMessage: z.string().optional(),
});

export type ExtractionJob = z.infer<typeof ExtractionJobSchema>;

import { z } from 'zod';
import { JobStatusSchema } from './job';

/**
 * Canonical ExtractionProgress schema.
 * Broadcast from runner/worker to side panel during execution.
 */
export const ExtractionProgressSchema = z.object({
  jobId: z.string().min(1, 'Job ID is required'),
  status: JobStatusSchema,
  currentPage: z.number().int().min(1).default(1),
  totalPagesTarget: z.number().int().min(1).optional(),
  recordsExtracted: z.number().int().min(0).default(0),
  recordsInCurrentPage: z.number().int().min(0).default(0),
  duplicatesCount: z.number().int().min(0).default(0),
  percentComplete: z.number().min(0).max(100).optional(),
  currentUrl: z.string().optional(),
  elapsedMs: z.number().min(0).default(0),
  timestamp: z.number().int().default(() => Date.now()),
});

export type ExtractionProgress = z.infer<typeof ExtractionProgressSchema>;

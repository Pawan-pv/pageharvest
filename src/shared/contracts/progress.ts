import { z } from 'zod';
import { JobProgressKindSchema, JobStatusSchema } from './job';

/**
 * Canonical ExtractionProgress schema.
 * The durable progress summary of a job, broadcast to open side panels after a
 * commit. Carries counters only: records are read from storage, never from this.
 */
export const ExtractionProgressSchema = z.object({
  jobId: z.string().min(1, 'Job ID is required'),
  datasetId: z.string().optional(),
  tabId: z.number().int().optional(),
  status: JobStatusSchema,
  progressKind: JobProgressKindSchema.default('single'),
  currentStep: z.number().int().min(0).default(0),
  targetSteps: z.number().int().min(1).optional(),
  recordsExtracted: z.number().int().min(0).default(0),
  duplicatesCount: z.number().int().min(0).default(0),
  stopReason: z.string().optional(),
  errorMessage: z.string().optional(),
  timestamp: z.number().int().default(() => Date.now()),
});

export type ExtractionProgress = z.infer<typeof ExtractionProgressSchema>;

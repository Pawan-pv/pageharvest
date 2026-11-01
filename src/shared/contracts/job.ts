import { z } from 'zod';
import { HarvestErrorSchema } from './error';
import { ExtractionSchemaSchema } from './schema';

/**
 * Extraction job lifecycle.
 *
 * CREATED      Written to storage, the page has not been asked to start.
 * RUNNING      The content script is extracting, or navigating between documents.
 * PAUSED       The user paused; the content script is holding at its pause gate.
 * INTERRUPTED  The execution context was lost (tab closed, reload, browser restart).
 * RECOVERABLE  An interrupted job whose checkpoint is valid and can be resumed.
 * COMPLETED    Finished, or stopped by the user keeping what was collected.
 * CANCELLED    Cancelled or discarded. Committed records are preserved.
 * FAILED       Stopped by an unrecoverable error. Committed records are preserved.
 * EXPIRED      A recoverable job abandoned past the retention period.
 *
 * The allowed transitions live in core/state/extraction-machine.ts.
 */
export const JobStatusSchema = z.enum([
  'CREATED',
  'RUNNING',
  'PAUSED',
  'INTERRUPTED',
  'RECOVERABLE',
  'COMPLETED',
  'CANCELLED',
  'FAILED',
  'EXPIRED',
]);

export type JobStatus = z.infer<typeof JobStatusSchema>;

export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = ['CREATED', 'RUNNING', 'PAUSED'];
export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = [
  'COMPLETED',
  'CANCELLED',
  'FAILED',
  'EXPIRED',
];

export function isTerminalJobStatus(status: JobStatus): boolean {
  return TERMINAL_JOB_STATUSES.includes(status);
}

export function isActiveJobStatus(status: JobStatus): boolean {
  return ACTIVE_JOB_STATUSES.includes(status);
}

/**
 * What progress counts. Pages and scroll iterations are different dimensions
 * and are never reported against each other's limits.
 */
export const JobProgressKindSchema = z.enum(['single', 'pages', 'scrolls']);
export type JobProgressKind = z.infer<typeof JobProgressKindSchema>;

/**
 * Identity carried by every extraction message.
 * `generation` is replaced whenever a job is resumed or ended, which makes any
 * message from an earlier execution detectably stale.
 */
export const JobIdentitySchema = z.object({
  jobId: z.string().min(1),
  projectId: z.string().min(1),
  datasetId: z.string().min(1),
  runId: z.string().min(1),
  generation: z.string().min(1),
});

export type JobIdentity = z.infer<typeof JobIdentitySchema>;

/**
 * Canonical ExtractionJob contract.
 * Represents one durable execution of an extraction schema.
 */
export const ExtractionJobSchema = z.object({
  id: z.string().min(1, 'Job ID is required'),
  projectId: z.string().optional(),
  datasetId: z.string().optional(),
  runId: z.string().optional(),
  generation: z.string().optional(),
  recipeId: z.string().optional(),
  schemaId: z.string().optional(),
  tabId: z.number().int().optional(),
  targetUrl: z.string().url('Valid target URL is required'),
  schema: ExtractionSchemaSchema,
  status: JobStatusSchema.default('CREATED'),
  progressKind: JobProgressKindSchema.default('single'),
  targetSteps: z.number().int().min(1).optional(),
  lastSequence: z.number().int().min(0).default(0),
  totalExtracted: z.number().int().min(0).default(0),
  duplicatesSkipped: z.number().int().min(0).default(0),
  pagesVisited: z.number().int().min(0).default(0),
  scrollsCompleted: z.number().int().min(0).default(0),
  recordsDetected: z.number().int().min(0).default(0),
  recordsWithMissingFields: z.number().int().min(0).default(0),
  recordsFiltered: z.number().int().min(0).default(0),
  recordsFailed: z.number().int().min(0).default(0),
  consecutiveEmptySteps: z.number().int().min(0).default(0),
  dedupeAlgorithm: z.string().optional(),
  stopReason: z.string().optional(),
  interruptedReason: z.string().optional(),
  interruptedAt: z.number().int().optional(),
  startedAt: z.number().int().default(() => Date.now()),
  pausedAt: z.number().int().optional(),
  pausedMs: z.number().int().min(0).default(0),
  finishedAt: z.number().int().optional(),
  updatedAt: z.number().int().default(() => Date.now()),
  errorMessage: z.string().optional(),
  errors: z.array(HarvestErrorSchema).default([]),
});

export type ExtractionJob = z.infer<typeof ExtractionJobSchema>;

/**
 * Resumable state of one job (the "pagination session").
 * Exists only while a job can still continue, and is deleted in the same
 * transaction that moves the job to a terminal status.
 */
export const JobCheckpointSchema = z.object({
  jobId: z.string().min(1),
  tabId: z.number().int().optional(),
  startUrl: z.string().url(),
  currentUrl: z.string().url(),
  expectedUrl: z.string().url().optional(),
  awaitingNavigation: z.boolean().default(false),
  navigationStartedAt: z.number().int().optional(),
  nextPage: z.number().int().min(1).default(1),
  scrollsCompleted: z.number().int().min(0).default(0),
  catchUpScrolls: z.number().int().min(0).default(0),
  visitedUrls: z.array(z.string()).default([]),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  expiresAt: z.number().int(),
});

export type JobCheckpoint = z.infer<typeof JobCheckpointSchema>;

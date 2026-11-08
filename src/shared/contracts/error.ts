import { z } from 'zod';

/**
 * Known error taxonomy codes for PageHarvest. The side panel chooses its explanation by
 * code only (ADR-031). VALIDATION_ERROR means the user's own setup is invalid, and its
 * message is written for the user; internal data that fails validation is UNKNOWN_ERROR.
 */
export const ExtractionErrorCodeSchema = z.enum([
  'CONTAINER_NOT_FOUND',
  'FIELD_EXTRACTION_FAILED',
  'PAGINATION_BUTTON_NOT_FOUND',
  'PAGINATION_TIMEOUT',
  'INFINITE_SCROLL_STALLED',
  'TAB_DISCONNECTED',
  'RATE_LIMITED',
  'STORAGE_ERROR',
  'VALIDATION_ERROR',
  'ABORTED_BY_USER',
  'UNKNOWN_ERROR',
]);

export type ExtractionErrorCode = z.infer<typeof ExtractionErrorCodeSchema>;

/**
 * Canonical ExtractionError schema.
 * Represents a structured, traceable error event.
 */
export const ExtractionErrorSchema = z.object({
  code: ExtractionErrorCodeSchema,
  message: z.string().min(1, 'Error message is required'),
  jobId: z.string().optional(),
  pageNumber: z.number().int().optional(),
  selector: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  recoverable: z.boolean().default(false),
  timestamp: z.number().int().default(() => Date.now()),
});

export type ExtractionError = z.infer<typeof ExtractionErrorSchema>;

/**
 * Workflow error reported by the runtime and persisted on the job it belongs to.
 */
export const HarvestErrorSchema = z.object({
  id: z.string().min(1),
  category: z.enum([
    'DOM_PARSING',
    'SELECTOR_NOT_FOUND',
    'PAGINATION_FAILED',
    'STORAGE_FAILED',
    'RUNTIME_MESSAGING',
    'VALIDATION_FAILED',
    'CIRCUIT_BREAKER_TRIGGERED',
    'UNKNOWN',
  ]),
  severity: z.enum(['WARN', 'ERROR', 'FATAL']),
  /** What the panel tells the user. Optional, so errors stored before ADR-031 still parse. */
  code: ExtractionErrorCodeSchema.optional(),
  message: z.string().min(1),
  timestamp: z.number(),
  context: z.record(z.string(), z.unknown()).optional(),
  stack: z.string().optional(),
});

export type HarvestErrorContract = z.infer<typeof HarvestErrorSchema>;

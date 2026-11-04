import { z } from 'zod';
import { HarvestErrorSchema } from './error';
import { MultiAnchorSelectorSchema } from './selector';
import { ExtractionFieldSchema } from './field';
import { JobIdentitySchema } from './job';
import { ExtractionProgressSchema } from './progress';
import { ExtractionRecordSchema } from './record';
import { ExtractionSchemaSchema } from './schema';

/**
 * The one runtime message protocol between the side panel, the background
 * service worker and content scripts. Every message is validated at each boundary.
 */
const baseMessageSchema = z.object({
  id: z.string().min(1),
  timestamp: z.number(),
});

const rectSchema = z.object({
  top: z.number(),
  left: z.number(),
  width: z.number(),
  height: z.number(),
});

// ---------------------------------------------------------------------------
// Connectivity
// ---------------------------------------------------------------------------
export const pingMessageSchema = baseMessageSchema.extend({
  type: z.literal('PING'),
  payload: z.object({ tabId: z.number().optional() }).optional(),
});

export const pongMessageSchema = baseMessageSchema.extend({
  type: z.literal('PONG'),
  payload: z.object({
    status: z.literal('OK'),
    url: z.string(),
    title: z.string().optional(),
  }),
});

export const contentReadyMessageSchema = baseMessageSchema.extend({
  type: z.literal('CONTENT_READY'),
  payload: z.object({
    url: z.string().url(),
    title: z.string().optional(),
  }),
});

// ---------------------------------------------------------------------------
// Picker
// ---------------------------------------------------------------------------
export const startPickerMessageSchema = baseMessageSchema.extend({
  type: z.literal('START_PICKER'),
  payload: z.object({ highlightColor: z.string().optional() }).optional(),
});

export const stopPickerMessageSchema = baseMessageSchema.extend({
  type: z.literal('STOP_PICKER'),
  payload: z.object({}).optional(),
});

export const elementHoveredMessageSchema = baseMessageSchema.extend({
  type: z.literal('ELEMENT_HOVERED'),
  payload: z.object({
    selector: z.string(),
    tagName: z.string(),
    rect: rectSchema.optional(),
  }),
});

export const elementSelectedMessageSchema = baseMessageSchema.extend({
  type: z.literal('ELEMENT_SELECTED'),
  payload: z.object({
    selector: z.string(),
    tagName: z.string(),
    classList: z.array(z.string()),
    textSnippet: z.string().optional(),
    matchCount: z.number().optional(),
    rect: rectSchema.optional(),
  }),
});

export const selectionConfirmedMessageSchema = baseMessageSchema.extend({
  type: z.literal('SELECTION_CONFIRMED'),
  payload: z.object({
    selector: z.string(),
    tagName: z.string(),
    matchCount: z.number().optional(),
  }),
});

export const selectionCancelledMessageSchema = baseMessageSchema.extend({
  type: z.literal('SELECTION_CANCELLED'),
  payload: z.object({}).optional(),
});

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------
export const CandidateKindSchema = z.enum(['list', 'table', 'links']);
export type CandidateKind = z.infer<typeof CandidateKindSchema>;

/** One thing on the page the user could extract, with the evidence for choosing it. */
export const ListCandidateSchema = z.object({
  containerSelector: z.string(),
  containerAnchor: MultiAnchorSelectorSchema.optional(),
  matchCount: z.number(),
  sampleSnippets: z.array(z.string()),
  name: z.string(),
  kind: CandidateKindSchema,
  credible: z.boolean(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()),
  suggestedFields: z.array(z.string()),
  dedupeFields: z.array(z.string()).optional(),
});
export type ListCandidate = z.infer<typeof ListCandidateSchema>;

export const detectRepeatedElementsMessageSchema = baseMessageSchema.extend({
  type: z.literal('DETECT_REPEATED_ELEMENTS'),
  payload: z
    .object({
      targetSelector: z.string().optional(),
      mode: z.enum(['table', 'links']).optional(),
    })
    .optional(),
});

export const repeatedElementsDetectedMessageSchema = baseMessageSchema.extend({
  type: z.literal('REPEATED_ELEMENTS_DETECTED'),
  payload: z.object({
    containerSelector: z.string(),
    /** Multi-tier fallback ladder of the best candidate's repeating item. */
    containerAnchor: MultiAnchorSelectorSchema.optional(),
    matchCount: z.number(),
    sampleSnippets: z.array(z.string()),
    candidates: z.array(ListCandidateSchema).optional(),
    credible: z.boolean().optional(),
  }),
});

export const detectFieldsMessageSchema = baseMessageSchema.extend({
  type: z.literal('DETECT_FIELDS'),
  payload: z.object({ containerSelector: z.string(), kind: CandidateKindSchema.optional() }),
});

export const fieldsDetectedMessageSchema = baseMessageSchema.extend({
  type: z.literal('FIELDS_DETECTED'),
  payload: z.object({
    containerSelector: z.string(),
    suggestedFields: z.array(ExtractionFieldSchema),
  }),
});

// ---------------------------------------------------------------------------
// Job commands: side panel -> background
// ---------------------------------------------------------------------------
export const startJobMessageSchema = baseMessageSchema.extend({
  type: z.literal('START_JOB'),
  payload: z.object({
    recipe: ExtractionSchemaSchema,
    tabId: z.number().int(),
    sourceUrl: z.string().url(),
    pageTitle: z.string().optional(),
    projectId: z.string().min(1).optional(),
    recipeId: z.string().min(1).optional(),
  }),
});

const jobCommandPayload = z.object({ jobId: z.string().min(1) });

export const pauseJobMessageSchema = baseMessageSchema.extend({
  type: z.literal('PAUSE_JOB'),
  payload: jobCommandPayload,
});

export const resumeJobMessageSchema = baseMessageSchema.extend({
  type: z.literal('RESUME_JOB'),
  payload: jobCommandPayload,
});

export const cancelJobMessageSchema = baseMessageSchema.extend({
  type: z.literal('CANCEL_JOB'),
  payload: jobCommandPayload,
});

export const finishJobMessageSchema = baseMessageSchema.extend({
  type: z.literal('FINISH_JOB'),
  payload: jobCommandPayload,
});

export const recoverJobMessageSchema = baseMessageSchema.extend({
  type: z.literal('RECOVER_JOB'),
  payload: jobCommandPayload,
});

export const discardJobMessageSchema = baseMessageSchema.extend({
  type: z.literal('DISCARD_JOB'),
  payload: jobCommandPayload,
});

export const reconcileJobsMessageSchema = baseMessageSchema.extend({
  type: z.literal('RECONCILE_JOBS'),
  payload: z.object({}).optional(),
});

// ---------------------------------------------------------------------------
// Job execution: background -> content script
// ---------------------------------------------------------------------------
export const JobResumeStateSchema = z.object({
  page: z.number().int().min(1),
  nextSequence: z.number().int().min(1),
  scrollsCompleted: z.number().int().min(0),
  catchUpScrolls: z.number().int().min(0),
  visitedUrls: z.array(z.string()),
  startUrl: z.string().url(),
});

export type JobResumeState = z.infer<typeof JobResumeStateSchema>;

export const extractRecordsMessageSchema = baseMessageSchema.extend({
  type: z.literal('EXTRACT_RECORDS'),
  payload: z.object({
    identity: JobIdentitySchema,
    recipe: ExtractionSchemaSchema,
    resume: JobResumeStateSchema,
  }),
});

export const controlJobMessageSchema = baseMessageSchema.extend({
  type: z.literal('CONTROL_JOB'),
  payload: z.object({
    identity: JobIdentitySchema,
    action: z.enum(['pause', 'resume', 'abort']),
  }),
});

export const queryJobRunMessageSchema = baseMessageSchema.extend({
  type: z.literal('QUERY_JOB_RUN'),
  payload: z.object({}).optional(),
});

// ---------------------------------------------------------------------------
// Job execution: content script -> background
// ---------------------------------------------------------------------------
export const BatchStatsSchema = z.object({
  detected: z.number().int().min(0),
  missingFields: z.number().int().min(0),
  filtered: z.number().int().min(0),
  failed: z.number().int().min(0),
  duplicates: z.number().int().min(0),
});

export type BatchStats = z.infer<typeof BatchStatsSchema>;

export const JobNavigationStateSchema = z.object({
  nextPage: z.number().int().min(1),
  scrollsCompleted: z.number().int().min(0),
  awaitingNavigation: z.boolean(),
  expectedUrl: z.string().url().optional(),
  visitedUrls: z.array(z.string()),
  url: z.string().url(),
  isCatchUp: z.boolean().optional(),
});

export type JobNavigationState = z.infer<typeof JobNavigationStateSchema>;

export const recordBatchMessageSchema = baseMessageSchema.extend({
  type: z.literal('RECORD_BATCH'),
  payload: z.object({
    identity: JobIdentitySchema,
    sequence: z.number().int().min(1),
    page: z.number().int().min(1),
    records: z.array(ExtractionRecordSchema),
    stats: BatchStatsSchema,
    navigation: JobNavigationStateSchema,
  }),
});

export const jobCheckpointMessageSchema = baseMessageSchema.extend({
  type: z.literal('JOB_CHECKPOINT'),
  payload: z.object({
    identity: JobIdentitySchema,
    navigation: JobNavigationStateSchema,
  }),
});

export const jobFinishedMessageSchema = baseMessageSchema.extend({
  type: z.literal('JOB_FINISHED'),
  payload: z.object({
    identity: JobIdentitySchema,
    lastSequence: z.number().int().min(0),
    stopReason: z.string().min(1),
  }),
});

export const jobFailedMessageSchema = baseMessageSchema.extend({
  type: z.literal('JOB_FAILED'),
  payload: z.object({
    identity: JobIdentitySchema,
    message: z.string().min(1),
    category: HarvestErrorSchema.shape.category,
    recoverable: z.boolean().default(false),
  }),
});

// ---------------------------------------------------------------------------
// Notifications: background -> side panel
// ---------------------------------------------------------------------------
export const jobUpdatedMessageSchema = baseMessageSchema.extend({
  type: z.literal('JOB_UPDATED'),
  payload: ExtractionProgressSchema,
});

export const extractionErrorMessageSchema = baseMessageSchema.extend({
  type: z.literal('EXTRACTION_ERROR'),
  payload: HarvestErrorSchema,
});

/**
 * Discriminated union of every message crossing an extension context boundary.
 */
export const BrowserMessageSchema = z.discriminatedUnion('type', [
  pingMessageSchema,
  pongMessageSchema,
  contentReadyMessageSchema,
  startPickerMessageSchema,
  stopPickerMessageSchema,
  elementHoveredMessageSchema,
  elementSelectedMessageSchema,
  selectionConfirmedMessageSchema,
  selectionCancelledMessageSchema,
  detectRepeatedElementsMessageSchema,
  repeatedElementsDetectedMessageSchema,
  detectFieldsMessageSchema,
  fieldsDetectedMessageSchema,
  startJobMessageSchema,
  pauseJobMessageSchema,
  resumeJobMessageSchema,
  cancelJobMessageSchema,
  finishJobMessageSchema,
  recoverJobMessageSchema,
  discardJobMessageSchema,
  reconcileJobsMessageSchema,
  extractRecordsMessageSchema,
  controlJobMessageSchema,
  queryJobRunMessageSchema,
  recordBatchMessageSchema,
  jobCheckpointMessageSchema,
  jobFinishedMessageSchema,
  jobFailedMessageSchema,
  jobUpdatedMessageSchema,
  extractionErrorMessageSchema,
]);

export type BrowserMessage = z.infer<typeof BrowserMessageSchema>;
export type BrowserMessageType = BrowserMessage['type'];

// ---------------------------------------------------------------------------
// Replies
// ---------------------------------------------------------------------------
export const BatchRejectionReasonSchema = z.enum([
  'unknown_job',
  'identity_mismatch',
  'stale_generation',
  'job_not_active',
  'wrong_tab',
  'out_of_order',
  'persist_failed',
]);

export type BatchRejectionReason = z.infer<typeof BatchRejectionReasonSchema>;

/**
 * Reply to RECORD_BATCH and JOB_CHECKPOINT. `committed` and `duplicate` are only
 * ever sent after the IndexedDB transaction has resolved.
 */
export const BatchAckSchema = z.object({
  status: z.enum(['committed', 'duplicate', 'rejected']),
  sequence: z.number().int().min(0),
  inserted: z.number().int().min(0),
  duplicates: z.number().int().min(0),
  reason: BatchRejectionReasonSchema.optional(),
  shouldStop: z.boolean().optional(),
});

export type BatchAck = z.infer<typeof BatchAckSchema>;

export const JobCommandResultSchema = z.object({
  ok: z.boolean(),
  identity: JobIdentitySchema.optional(),
  error: z.string().optional(),
});

export type JobCommandResult = z.infer<typeof JobCommandResultSchema>;

export const JobRunStatusSchema = z.object({
  active: z.boolean(),
  jobId: z.string().optional(),
  generation: z.string().optional(),
  paused: z.boolean().optional(),
});

export type JobRunStatus = z.infer<typeof JobRunStatusSchema>;

export const ContentCommandResultSchema = z.object({
  accepted: z.boolean(),
  reason: z.string().optional(),
});

export type ContentCommandResult = z.infer<typeof ContentCommandResultSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export function serializeMessage(message: BrowserMessage): string {
  return JSON.stringify(BrowserMessageSchema.parse(message));
}

export function deserializeMessage(jsonString: string): BrowserMessage {
  return BrowserMessageSchema.parse(JSON.parse(jsonString));
}

export function isValidMessage(data: unknown): data is BrowserMessage {
  return BrowserMessageSchema.safeParse(data).success;
}

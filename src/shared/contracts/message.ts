import { z } from 'zod';
import { ExtractionFieldSchema } from './field';
import { DetectedListSchema, BoundingBoxSchema } from './detected-list';
import { ExtractionRecordSchema } from './record';
import { ExtractionProgressSchema } from './progress';
import { ExtractionErrorSchema } from './error';

/**
 * Discrimination message variants between Extension contexts
 * (Side Panel <-> Background Service Worker <-> Content Script).
 */

export const PingMessageSchema = z.object({
  type: z.literal('PING'),
  timestamp: z.number().default(() => Date.now()),
});

export const PongMessageSchema = z.object({
  type: z.literal('PONG'),
  url: z.string(),
  title: z.string(),
  ready: z.boolean(),
});

export const StartInspectorMessageSchema = z.object({
  type: z.literal('START_INSPECTOR'),
  mode: z.enum(['container', 'field']).default('container'),
});

export const StopInspectorMessageSchema = z.object({
  type: z.literal('STOP_INSPECTOR'),
});

export const ElementHoveredMessageSchema = z.object({
  type: z.literal('ELEMENT_HOVERED'),
  selector: z.string(),
  tagName: z.string(),
  previewText: z.string(),
  boundingBox: BoundingBoxSchema.optional(),
});

export const ElementSelectedMessageSchema = z.object({
  type: z.literal('ELEMENT_SELECTED'),
  selector: z.string(),
  tagName: z.string(),
  previewText: z.string(),
  attributes: z.record(z.string()).default({}),
  boundingBox: BoundingBoxSchema.optional(),
});

export const DetectListsRequestSchema = z.object({
  type: z.literal('DETECT_LISTS_REQUEST'),
  seedSelector: z.string().optional(),
});

export const DetectListsResponseSchema = z.object({
  type: z.literal('DETECT_LISTS_RESPONSE'),
  candidates: z.array(DetectedListSchema),
});

export const DetectFieldsRequestSchema = z.object({
  type: z.literal('DETECT_FIELDS_REQUEST'),
  containerSelector: z.string(),
});

export const DetectFieldsResponseSchema = z.object({
  type: z.literal('DETECT_FIELDS_RESPONSE'),
  containerSelector: z.string(),
  fields: z.array(ExtractionFieldSchema),
});

export const ExtractPageRequestSchema = z.object({
  type: z.literal('EXTRACT_PAGE_REQUEST'),
  containerSelector: z.string(),
  fields: z.array(ExtractionFieldSchema),
  pageNumber: z.number().int().min(1).default(1),
  jobId: z.string().optional(),
});

export const ExtractPageResponseSchema = z.object({
  type: z.literal('EXTRACT_PAGE_RESPONSE'),
  pageNumber: z.number().int().min(1),
  records: z.array(ExtractionRecordSchema),
  totalFound: z.number().int().min(0),
});

export const PaginationStepRequestSchema = z.object({
  type: z.literal('PAGINATION_STEP_REQUEST'),
  nextButtonSelector: z.string(),
  timeoutMs: z.number().int().default(5000),
});

export const PaginationStepResponseSchema = z.object({
  type: z.literal('PAGINATION_STEP_RESPONSE'),
  success: z.boolean(),
  hasNext: z.boolean(),
  newUrl: z.string().optional(),
  error: z.string().optional(),
});

export const ScrollStepRequestSchema = z.object({
  type: z.literal('SCROLL_STEP_REQUEST'),
  distance: z.number().int().default(1000),
  delayMs: z.number().int().default(1500),
});

export const ScrollStepResponseSchema = z.object({
  type: z.literal('SCROLL_STEP_RESPONSE'),
  success: z.boolean(),
  reachedBottom: z.boolean(),
  newElementsLoaded: z.boolean(),
});

export const JobProgressMessageSchema = z.object({
  type: z.literal('JOB_PROGRESS'),
  progress: ExtractionProgressSchema,
});

export const JobCompletedMessageSchema = z.object({
  type: z.literal('JOB_COMPLETED'),
  jobId: z.string(),
  totalExtracted: z.number().int(),
  duplicatesSkipped: z.number().int(),
  pagesVisited: z.number().int(),
  durationMs: z.number(),
});

export const JobFailedMessageSchema = z.object({
  type: z.literal('JOB_FAILED'),
  jobId: z.string(),
  error: ExtractionErrorSchema,
});

export const StopJobMessageSchema = z.object({
  type: z.literal('STOP_JOB'),
  jobId: z.string(),
});

/**
 * Discriminated union of all BrowserMessages.
 */
export const BrowserMessageSchema = z.discriminatedUnion('type', [
  PingMessageSchema,
  PongMessageSchema,
  StartInspectorMessageSchema,
  StopInspectorMessageSchema,
  ElementHoveredMessageSchema,
  ElementSelectedMessageSchema,
  DetectListsRequestSchema,
  DetectListsResponseSchema,
  DetectFieldsRequestSchema,
  DetectFieldsResponseSchema,
  ExtractPageRequestSchema,
  ExtractPageResponseSchema,
  PaginationStepRequestSchema,
  PaginationStepResponseSchema,
  ScrollStepRequestSchema,
  ScrollStepResponseSchema,
  JobProgressMessageSchema,
  JobCompletedMessageSchema,
  JobFailedMessageSchema,
  StopJobMessageSchema,
]);

export type BrowserMessage = z.infer<typeof BrowserMessageSchema>;
export type BrowserMessageType = BrowserMessage['type'];

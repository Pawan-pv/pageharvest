import { z } from 'zod';
import { ExtractionFieldSchema } from './field';

/**
 * Sample item representation inside a detected list candidate.
 */
export const DetectedItemSampleSchema = z.object({
  tag: z.string(),
  previewText: z.string(),
  classes: z.array(z.string()).default([]),
  attributes: z.record(z.string(), z.string()).default({}),
});

export type DetectedItemSample = z.infer<typeof DetectedItemSampleSchema>;

/**
 * Bounding box for visual highlighting on page.
 */
export const BoundingBoxSchema = z.object({
  top: z.number(),
  left: z.number(),
  width: z.number(),
  height: z.number(),
});

export type BoundingBox = z.infer<typeof BoundingBoxSchema>;

/**
 * Canonical DetectedList schema.
 * Produced by DOM repeated pattern detection engine.
 */
export const DetectedListSchema = z.object({
  containerSelector: z.string().min(1, 'Container selector is required'),
  itemCount: z.number().int().min(1),
  sampleItems: z.array(DetectedItemSampleSchema).default([]),
  suggestedFields: z.array(ExtractionFieldSchema).default([]),
  confidence: z.number().min(0).max(1).default(1),
  boundingBox: BoundingBoxSchema.optional(),
});

export type DetectedList = z.infer<typeof DetectedListSchema>;

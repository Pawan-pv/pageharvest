import { z } from 'zod';

/**
 * Value primitive types supported within extracted records.
 */
export const RecordValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.undefined(),
]);

export type RecordValue = z.infer<typeof RecordValueSchema>;

/**
 * Canonical ExtractionRecord schema.
 * Represents a single extracted structured row, augmented with provenance metadata.
 */
export const ExtractionRecordSchema = z.object({
  _id: z.string().min(1, 'Record ID is required'),
  _projectId: z.string().optional(),
  _jobId: z.string().optional(),
  _runId: z.string().optional(),
  _page: z.number().int().min(1).default(1),
  _order: z.number().optional(), // Stable extraction order within the dataset
  _extractedAt: z.number().int().default(() => Date.now()),
  _sourceUrl: z.string().optional(),
  _hash: z.string().optional(), // SHA-256 of the canonical record, see core/extraction/record-identity
  _missingFields: z.string().optional(), // Names of selected fields with no value in this record
}).catchall(RecordValueSchema);

export type ExtractionRecord = z.infer<typeof ExtractionRecordSchema>;

/**
 * Keys that describe a record rather than belong to the extracted data.
 * Every grid, export, cleaning and identity path must use this single definition.
 */
export function isRecordMetadataKey(key: string): boolean {
  return key.startsWith('_') || key === 'datasetId';
}

import { z } from 'zod';
import {
  ExtractionFieldSchema,
  FieldExtractorTypeSchema,
  FieldTransformSchema,
} from '../shared/contracts/field';
import {
  PaginationConfigSchema,
  PaginationTypeSchema,
  PaginationStopConditionSchema,
} from '../shared/contracts/pagination';
import { ExtractionSchemaSchema } from '../shared/contracts/schema';
import { ExtractionProjectSchema, ProjectStatusSchema } from '../shared/contracts/project';
import { ExtractionRecordSchema, RecordValueSchema } from '../shared/contracts/record';
import {
  DetectedListSchema,
  DetectedItemSampleSchema,
  BoundingBoxSchema,
} from '../shared/contracts/detected-list';
import { ExtractionJobSchema, JobStatusSchema } from '../shared/contracts/job';
import { ExtractionProgressSchema } from '../shared/contracts/progress';
import { ExtractionErrorSchema, ExtractionErrorCodeSchema } from '../shared/contracts/error';
import {
  BrowserMessageSchema,
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
} from '../shared/contracts/message';
import {
  ExportConfigSchema,
  ExportFormatSchema,
  CsvDelimiterSchema,
} from '../shared/contracts/export';
import { UserSettingsSchema } from '../shared/contracts/settings';

// Re-export all canonical PascalCase schemas from shared contracts
export {
  ExtractionFieldSchema,
  FieldExtractorTypeSchema,
  FieldTransformSchema,
  PaginationConfigSchema,
  PaginationTypeSchema,
  PaginationStopConditionSchema,
  ExtractionSchemaSchema,
  ExtractionProjectSchema,
  ProjectStatusSchema,
  ExtractionRecordSchema,
  RecordValueSchema,
  DetectedListSchema,
  DetectedItemSampleSchema,
  BoundingBoxSchema,
  ExtractionJobSchema,
  JobStatusSchema,
  ExtractionProgressSchema,
  ExtractionErrorSchema,
  ExtractionErrorCodeSchema,
  BrowserMessageSchema,
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
  ExportConfigSchema,
  ExportFormatSchema,
  CsvDelimiterSchema,
  UserSettingsSchema,
};

// Aliases matching earlier contract conventions
export const FieldDefinitionSchema = ExtractionFieldSchema;
export const ExtractionRecipeSchema = ExtractionSchemaSchema;
export const ExtractedRecordSchema = ExtractionRecordSchema;

export const DatasetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  url: z.string(),
  recipeId: z.string().optional(),
  recordsCount: z.number().int().min(0).default(0),
  fields: z.array(ExtractionFieldSchema),
  createdAt: z.number().int().default(() => Date.now()),
  updatedAt: z.number().int().default(() => Date.now()),
});

export const ExtensionMessageSchema = z.union([
  BrowserMessageSchema,
  z.object({
    type: z.literal('EXTRACT_RECORDS'),
    containerSelector: z.string(),
    fields: z.array(ExtractionFieldSchema),
    pageNumber: z.number().int().default(1),
  }),
]);

// CamelCase aliases for backward compatibility
export const fieldExtractorTypeSchema = FieldExtractorTypeSchema;
export const fieldDefinitionSchema = ExtractionFieldSchema;
export const extractionPaginationConfigSchema = PaginationConfigSchema;
export const extractionRecipeSchema = ExtractionSchemaSchema;
export const extractedRecordSchema = ExtractionRecordSchema;
export const datasetEntitySchema = DatasetSchema;
export const harvestErrorSchema = z.object({
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
  message: z.string().min(1),
  timestamp: z.number(),
  context: z.record(z.unknown()).optional(),
  stack: z.string().optional(),
});

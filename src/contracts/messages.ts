import { z } from 'zod';
import {
  fieldDefinitionSchema,
  extractionRecipeSchema,
  extractedRecordSchema,
  harvestErrorSchema
} from './schemas';
import { FieldDefinition, ExtractionRecipe, ExtractedRecord } from '@/types';
import { HarvestError } from '@/types/error';

// Base envelope
export const baseMessageSchema = z.object({
  id: z.string().min(1),
  timestamp: z.number()
});

// 1. PING / PONG
export const pingMessageSchema = baseMessageSchema.extend({
  type: z.literal('PING'),
  payload: z.object({
    tabId: z.number().optional()
  }).optional()
});

export const pongMessageSchema = baseMessageSchema.extend({
  type: z.literal('PONG'),
  payload: z.object({
    status: z.literal('OK'),
    url: z.string(),
    title: z.string().optional()
  })
});

// 2. PICKER LIFECYCLE
export const startPickerMessageSchema = baseMessageSchema.extend({
  type: z.literal('START_PICKER'),
  payload: z.object({
    highlightColor: z.string().optional()
  }).optional()
});

export const stopPickerMessageSchema = baseMessageSchema.extend({
  type: z.literal('STOP_PICKER'),
  payload: z.object({}).optional()
});

export const elementSelectedMessageSchema = baseMessageSchema.extend({
  type: z.literal('ELEMENT_SELECTED'),
  payload: z.object({
    selector: z.string(),
    tagName: z.string(),
    classList: z.array(z.string()),
    textSnippet: z.string().optional()
  })
});

// 3. DETECTION & PREVIEW
export const detectRepeatedElementsMessageSchema = baseMessageSchema.extend({
  type: z.literal('DETECT_REPEATED_ELEMENTS'),
  payload: z.object({
    targetSelector: z.string().optional()
  }).optional()
});

export const repeatedElementsDetectedMessageSchema = baseMessageSchema.extend({
  type: z.literal('REPEATED_ELEMENTS_DETECTED'),
  payload: z.object({
    containerSelector: z.string(),
    matchCount: z.number(),
    sampleSnippets: z.array(z.string())
  })
});

export const detectFieldsMessageSchema = baseMessageSchema.extend({
  type: z.literal('DETECT_FIELDS'),
  payload: z.object({
    containerSelector: z.string()
  })
});

export const fieldsDetectedMessageSchema = baseMessageSchema.extend({
  type: z.literal('FIELDS_DETECTED'),
  payload: z.object({
    containerSelector: z.string(),
    suggestedFields: z.array(fieldDefinitionSchema)
  })
});

// 4. EXTRACTION
export const extractRecordsMessageSchema = baseMessageSchema.extend({
  type: z.literal('EXTRACT_RECORDS'),
  payload: z.object({
    recipe: extractionRecipeSchema.optional(),
    containerSelector: z.string().optional(),
    fields: z.array(fieldDefinitionSchema).optional(),
    pageNumber: z.number().int().positive().default(1)
  })
});

export const extractionProgressMessageSchema = baseMessageSchema.extend({
  type: z.literal('EXTRACTION_PROGRESS'),
  payload: z.object({
    page: z.number(),
    records: z.array(extractedRecordSchema),
    newRecordsCount: z.number(),
    duplicatesCount: z.number(),
    isComplete: z.boolean()
  })
});

export const executePaginationStepMessageSchema = baseMessageSchema.extend({
  type: z.literal('EXECUTE_PAGINATION_STEP'),
  payload: z.object({
    nextButtonSelector: z.string(),
    delayMs: z.number().int().nonnegative().default(1000)
  })
});

export const executeScrollStepMessageSchema = baseMessageSchema.extend({
  type: z.literal('EXECUTE_SCROLL_STEP'),
  payload: z.object({
    scrollDelayMs: z.number().int().nonnegative().default(500)
  })
});

export const extractionErrorMessageSchema = baseMessageSchema.extend({
  type: z.literal('EXTRACTION_ERROR'),
  payload: harvestErrorSchema
});

// Master Discriminated Union
export const extensionMessageSchema = z.discriminatedUnion('type', [
  pingMessageSchema,
  pongMessageSchema,
  startPickerMessageSchema,
  stopPickerMessageSchema,
  elementSelectedMessageSchema,
  detectRepeatedElementsMessageSchema,
  repeatedElementsDetectedMessageSchema,
  detectFieldsMessageSchema,
  fieldsDetectedMessageSchema,
  extractRecordsMessageSchema,
  extractionProgressMessageSchema,
  executePaginationStepMessageSchema,
  executeScrollStepMessageSchema,
  extractionErrorMessageSchema
]);

export type ExtensionMessage = z.infer<typeof extensionMessageSchema>;

// Serialization and Validation Helpers
export function serializeMessage(message: ExtensionMessage): string {
  // Validate before serialization
  const validated = extensionMessageSchema.parse(message);
  return JSON.stringify(validated);
}

export function deserializeMessage(jsonString: string): ExtensionMessage {
  const parsed = JSON.parse(jsonString);
  return extensionMessageSchema.parse(parsed);
}

export function isValidMessage(data: unknown): data is ExtensionMessage {
  return extensionMessageSchema.safeParse(data).success;
}

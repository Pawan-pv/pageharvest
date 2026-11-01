import { z } from 'zod';

/**
 * Extraction field extraction methods.
 */
export const FieldExtractorTypeSchema = z.enum([
  'text',      // Stripped, normalized textContent or innerText
  'attribute', // Specific HTML attribute value
  'href',      // Resolves relative href to absolute URL
  'src',       // Resolves relative src to absolute URL
  'html',      // Raw innerHTML string
  'number',    // Cleaned floating point / integer number
  'regex',     // Regex pattern matched against textContent
]);

export type FieldExtractorType = z.infer<typeof FieldExtractorTypeSchema>;

/**
 * Text transformation operations applied after extraction.
 */
export const FieldTransformSchema = z.enum([
  'none',
  'trim',
  'lowercase',
  'uppercase',
  'capitalize',
]);

export type FieldTransform = z.infer<typeof FieldTransformSchema>;

/**
 * Canonical ExtractionField definition schema.
 */
export const ExtractionFieldSchema = z.object({
  id: z.string().min(1, 'Field ID is required'),
  name: z.string().min(1, 'Field name is required'),
  selector: z.string().min(1, 'Selector is required'),
  extractor: FieldExtractorTypeSchema,
  attributeName: z.string().optional(),
  regexPattern: z.string().optional(),
  regexGroup: z.number().int().min(0).default(0).optional(),
  defaultValue: z.string().optional(),
  required: z.boolean().default(false),
  transform: FieldTransformSchema.default('trim'),
}).refine(
  (data) => {
    if (data.extractor === 'attribute') {
      return typeof data.attributeName === 'string' && data.attributeName.trim().length > 0;
    }
    return true;
  },
  {
    message: "attributeName is required when extractor is 'attribute'",
    path: ['attributeName'],
  }
).refine(
  (data) => {
    if (data.extractor === 'regex') {
      return typeof data.regexPattern === 'string' && data.regexPattern.trim().length > 0;
    }
    return true;
  },
  {
    message: "regexPattern is required when extractor is 'regex'",
    path: ['regexPattern'],
  }
);

export type ExtractionField = z.infer<typeof ExtractionFieldSchema>;

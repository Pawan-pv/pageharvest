import { z } from 'zod';

/**
 * Supported data export file formats.
 */
export const ExportFormatSchema = z.enum([
  'csv',        // RFC 4180 standard comma-separated values
  'json',       // Formatted JSON array
  'ndjson',     // Newline-delimited JSON
  'xlsx',       // Office Open XML spreadsheet (.xlsx)
  'html_table', // Standalone styled HTML table
]);

export type ExportFormat = z.infer<typeof ExportFormatSchema>;

/**
 * CSV delimiter options.
 */
export const CsvDelimiterSchema = z.enum([',', ';', '\t']);
export type CsvDelimiter = z.infer<typeof CsvDelimiterSchema>;

/**
 * Canonical ExportConfig schema.
 * Configures the data export pipeline.
 */
export const ExportConfigSchema = z.object({
  format: ExportFormatSchema.default('csv'),
  selectedFieldIds: z.array(z.string()).optional(),
  includeMetadata: z.boolean().default(false), // Include _id, _page, _extractedAt
  csvDelimiter: CsvDelimiterSchema.default(','),
  prettyJson: z.boolean().default(true),
  filename: z.string().min(1).default(() => `pageharvest_export_${Date.now()}`),
});

export type ExportConfig = z.infer<typeof ExportConfigSchema>;

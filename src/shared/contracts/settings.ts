import { z } from 'zod';

export const CURRENT_SETTINGS_VERSION = 2;

/**
 * Persisted user preferences. Every field here has a production reader:
 * the export dialog, the extraction configuration defaults, the job coordinator
 * (retention) and the progress view (record warning threshold).
 */
export const UserSettingsSchema = z.object({
  id: z.string().default('current'),
  schemaVersion: z.number().int().default(CURRENT_SETTINGS_VERSION),
  defaultExportFormat: z.enum(['csv', 'json', 'ndjson', 'xlsx']).default('csv'),
  csvDelimiter: z.enum([',', ';', '\t']).default(','),
  csvIncludeBom: z.boolean().default(true),
  jsonIndent: z.number().int().min(0).max(8).default(2),
  defaultDelayMs: z.number().int().min(200).max(30000).default(1500),
  defaultMaxPages: z.number().int().min(1).max(500).default(20),
  defaultMaxScrolls: z.number().int().min(1).max(200).default(30),
  defaultScrollDelayMs: z.number().int().min(300).max(10000).default(1500),
  retentionDays: z.number().int().min(1).max(365).default(30),
  maxRecordsWarningThreshold: z.number().int().min(100).default(10000),
  updatedAt: z.number().int().default(() => Date.now()),
});

export type UserSettingsContract = z.infer<typeof UserSettingsSchema>;

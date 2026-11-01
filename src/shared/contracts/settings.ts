import { z } from 'zod';

export const UserSettingsSchema = z.object({
  id: z.string().default('current'),
  theme: z.enum(['light', 'dark', 'system']).default('system'),
  defaultExportFormat: z.enum(['csv', 'json', 'ndjson']).default('csv'),
  csvDelimiter: z.enum([',', ';', '\t']).default(','),
  csvIncludeBom: z.boolean().default(true),
  jsonIndent: z.number().int().min(0).max(8).default(2),
  autoCleanOnExtract: z.boolean().default(false),
  retentionDays: z.number().int().min(1).default(30),
  maxRecordsWarningThreshold: z.number().int().min(100).default(10000),
  updatedAt: z.number().int().default(() => Date.now()),
});

export type UserSettingsContract = z.infer<typeof UserSettingsSchema>;

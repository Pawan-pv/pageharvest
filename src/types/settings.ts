export type ExportFormat = 'csv' | 'json' | 'ndjson';
export type CsvDelimiter = ',' | ';' | '\t';

export interface UserSettings {
  id: string; // 'current' or 'global'
  theme: 'light' | 'dark' | 'system';
  defaultExportFormat: ExportFormat;
  csvDelimiter: CsvDelimiter;
  csvIncludeBom: boolean;
  jsonIndent: number;
  autoCleanOnExtract: boolean;
  retentionDays: number;
  maxRecordsWarningThreshold: number;
  updatedAt: number;
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  id: 'current',
  theme: 'system',
  defaultExportFormat: 'csv',
  csvDelimiter: ',',
  csvIncludeBom: true,
  jsonIndent: 2,
  autoCleanOnExtract: false,
  retentionDays: 30,
  maxRecordsWarningThreshold: 10000,
  updatedAt: Date.now(),
};

import { UserSettingsContract, UserSettingsSchema } from '@/shared/contracts/settings';

export type ExportFormat = 'csv' | 'json' | 'ndjson';
export type CsvDelimiter = ',' | ';' | '\t';

export type UserSettings = UserSettingsContract;

export const DEFAULT_USER_SETTINGS: UserSettings = UserSettingsSchema.parse({});

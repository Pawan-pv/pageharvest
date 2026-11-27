import { generateExportFilename, recordsToCsvChunks } from '@/core/export/exporter';
import { triggerDownload, type DownloadResult } from '@/platform/downloads';
import { SettingsRepository } from '@/storage/repositories/settings-repository';
import { DEFAULT_USER_SETTINGS } from '@/types/settings';
import type { ExtractedRecord, FieldDefinition } from '@/types';

/** The two files a spreadsheet user asks for. JSON and NDJSON stay in the export dialog. */
export type QuickFormat = 'xlsx' | 'csv';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Downloads every row in one step, with no dialog: the columns as they are, no row details,
 * and for CSV the delimiter and UTF-8 mark saved in Settings. The file is named after the
 * data and today's date. Resolves like `triggerDownload`: success means Chrome accepted it.
 */
/**
 * A saved list is named after its page and the day it was collected ("Books - 11/12/2026").
 * The file name ends with today's date already, so the first one is left out of it.
 */
export function nameWithoutDate(name: string | undefined): string | undefined {
  return name?.replace(/\s*[-–]\s*\d{1,4}[./-]\d{1,2}[./-]\d{1,4}\s*$/, '');
}

export async function downloadRows(
  records: ExtractedRecord[],
  fields: FieldDefinition[] | undefined,
  { format, name }: { format: QuickFormat; name?: string }
): Promise<DownloadResult> {
  try {
    const filename = generateExportFilename({ datasetName: nameWithoutDate(name), format });
    if (format === 'xlsx') {
      // The workbook writer is its own chunk, loaded only when someone asks for Excel.
      const { recordsToXlsx } = await import('@/core/export/xlsx');
      return await triggerDownload({ content: recordsToXlsx(records, fields), filename, mimeType: XLSX_MIME });
    }
    const settings = await new SettingsRepository().getSettings().catch(() => DEFAULT_USER_SETTINGS);
    const content = Array.from(
      recordsToCsvChunks(records, fields, {
        includeMetadata: false,
        useBom: settings.csvIncludeBom,
        delimiter: settings.csvDelimiter,
      })
    );
    return await triggerDownload({ content, filename, mimeType: 'text/csv' });
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

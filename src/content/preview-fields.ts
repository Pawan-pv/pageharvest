import { ExtractionEngine } from '@/core/extraction/extractor';
import {
  FieldPreviewResultSchema,
  type FieldPreviewResult,
  type BrowserMessage,
} from '@/shared/contracts/message';

type PreviewPayload = Extract<BrowserMessage, { type: 'PREVIEW_FIELDS' }>['payload'];
type Cell = string | number | boolean | null;

function toCell(value: unknown): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
}

/**
 * Reads the first items of a list with the given fields (ADR-030). Strictly read-only: it
 * queries the DOM and runs the extraction engine, which only reads; it stores nothing,
 * sends nothing, and changes no job. The reply is validated before it leaves the page.
 */
export function previewFields(
  root: Document,
  payload: PreviewPayload,
  options: { jobActive: boolean; baseUrl: string }
): FieldPreviewResult {
  if (options.jobActive) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'An extraction is running in this tab. The preview is available again when it finishes.',
    };
  }

  let matchCount: number;
  try {
    matchCount = root.querySelectorAll(payload.containerSelector).length;
  } catch {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'The saved position of the list is not valid. Pick the list on the page again.',
    };
  }
  if (matchCount === 0) {
    return {
      ok: false,
      code: 'CONTAINER_NOT_FOUND',
      message: 'The list is no longer on this page. It may have changed or reloaded.',
    };
  }

  // Required columns filter rows during a run; the preview shows every item instead.
  const fields = payload.fields.map((field) => ({ ...field, required: false }));
  const output = new ExtractionEngine().extract({
    root,
    repeatedItemSelector: payload.containerSelector,
    fields,
    baseUrl: options.baseUrl,
    deduplication: { enabled: false },
    validation: { validateRequired: false },
  });

  const rows = output.records
    .slice(0, payload.limit)
    .map((record) => Object.fromEntries(payload.fields.map((field) => [field.name, toCell(record[field.name])])));

  return FieldPreviewResultSchema.parse({ ok: true, rows, matchCount });
}

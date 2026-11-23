import { extractRecordsFromContainers } from '@/core/extraction/extractor';
import { recoverContainerItems } from '@/core/detection/anchors';
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
 * queries the DOM and runs the shared extraction loop, which only reads. It stores nothing,
 * sends nothing, changes no job, and never writes a healed selector or anchor anywhere; when
 * the list is found only through its backup anchor, the reply says so.
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

  let items: Element[] = [];
  let selectorInvalid = false;
  try {
    items = Array.from(root.querySelectorAll(payload.containerSelector));
  } catch {
    selectorInvalid = true;
  }

  let usedFallback = false;
  if (items.length === 0 && payload.containerAnchor) {
    const recovered = recoverContainerItems(root, payload.containerAnchor);
    if (recovered.length > 0) {
      items = recovered;
      usedFallback = true;
    }
  }

  if (items.length === 0) {
    return selectorInvalid
      ? {
          ok: false,
          code: 'VALIDATION_ERROR',
          message: 'The saved position of the list is not valid. Pick the list on the page again.',
        }
      : {
          ok: false,
          code: 'CONTAINER_NOT_FOUND',
          message: 'The list is no longer on this page. It may have changed or reloaded.',
        };
  }

  // Required columns filter rows during a run; the preview shows every item instead.
  const fields = payload.fields.map((field) => ({ ...field, required: false }));
  const { records } = extractRecordsFromContainers(items.slice(0, payload.limit), fields, 1, undefined, options.baseUrl);
  const rows = records.map((record) =>
    Object.fromEntries(payload.fields.map((field) => [field.name, toCell(record[field.name])]))
  );

  return FieldPreviewResultSchema.parse({ ok: true, rows, matchCount: items.length, usedFallback });
}

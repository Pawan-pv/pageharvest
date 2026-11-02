import { ExtractionRecipe, ExtractedRecord, FieldDefinition } from '@/types';
import { ExtractionField, ExtractionSchema } from '@/shared/contracts';
import { normalizeFieldValue, normalizeText, pageLocaleOf } from './normalizer';
import { parseNumberDetailed, NumberParseResult } from '@/utils/number-parser';
import { readTableCell } from './table-extractor';
import { DuplicateDetector, generateRecordSignature } from './duplicate-detector';
import { validateExtractionInput, validateRecord, isValidCssSelector } from './validator';
import {
  ExtractionInput,
  ExtractionOutput,
  ExtractionMetadata,
  ExtractionStatistics,
  ExtractionJobError,
  ExtractionFieldConfig,
  ExtendedFieldExtractorType,
} from './types';

export type { ExtractionInput, ExtractionOutput, ExtractionMetadata, ExtractionStatistics, ExtractionJobError };

function normalizeExtractor(value: string): ExtendedFieldExtractorType {
  switch (value) {
    case 'link':
    case 'links':
      return value;
    case 'image':
    case 'images':
      return value;
    case 'price':
    case 'prices':
    case 'numeric':
      return value;
    case 'date':
    case 'dates':
    case 'boolean':
    case 'metadata':
      return value;
    case 'text':
    case 'attribute':
    case 'href':
    case 'src':
    case 'html':
    case 'number':
    case 'regex':
    case 'table_cell':
    case 'link_text':
      return value;
    default:
      return 'text';
  }
}

function getFieldTransform(
  field: FieldDefinition | ExtractionField | ExtractionFieldConfig
): FieldDefinition['transform'] {
  return 'transform' in field && field.transform ? field.transform : 'trim';
}

export interface ExtractionResult {
  records: ExtractedRecord[];
  duplicatesCount: number;
  /** Containers examined in this pass, excluding elements unchanged since the last pass. */
  totalParsed: number;
  /** Kept records that have no value for at least one selected field. */
  missingFieldCount: number;
  /** Records excluded because the user marked a missing field as required. */
  filteredCount: number;
  /** Containers that could not be processed at all. */
  failedCount: number;
  errors?: ExtractionJobError[];
  statistics?: ExtractionStatistics;
  metadata?: ExtractionMetadata;
}

function resolveFieldTarget(
  element: Element,
  field: FieldDefinition | ExtractionField | ExtractionFieldConfig
): Element | null {
  const sel = field.selector ? field.selector.trim() : '';
  if (!sel || sel === '.' || sel === ':scope') return element;
  try {
    return element.matches && element.matches(sel) ? element : element.querySelector(sel);
  } catch {
    return null;
  }
}

function isNumberField(field: FieldDefinition | ExtractionField | ExtractionFieldConfig): boolean {
  const extractor = (field.extractor || 'text').toLowerCase();
  return extractor === 'number' || extractor === 'numeric';
}

/**
 * Reads a number field once, returning the value and how it was read. The note is stored
 * with the row, so the original text, the currency and anything uncertain are never lost
 * when the cell holds only a number.
 */
function readNumberField(
  container: Element,
  field: FieldDefinition | ExtractionField | ExtractionFieldConfig
): { value: string | number | boolean | null; note: NumberParseResult | null } {
  const fallback = field.defaultValue !== undefined ? field.defaultValue : null;
  const target = resolveFieldTarget(container, field);
  if (!target) return { value: fallback, note: null };

  const text = normalizeText((target as HTMLElement).innerText || target.textContent);
  if (!text) return { value: fallback, note: null };

  const note = parseNumberDetailed(text, { locale: pageLocaleOf(target) });
  // A range or an uncertain value stays as its text. It is never replaced by a guess.
  const value = note.status === 'ok' ? note.value : note.status === 'invalid' ? fallback : text;
  return { value, note };
}

/**
 * Extracts a single field value from a container or target DOM element.
 * Safely handles invalid CSS selectors and missing elements without crashing.
 */
export function extractFieldValue(
  element: Element | null,
  field: FieldDefinition | ExtractionField | ExtractionFieldConfig,
  baseUrl?: string
): string | number | boolean | null {
  if (!element) {
    return field.defaultValue !== undefined ? field.defaultValue : null;
  }

  const targetEl = resolveFieldTarget(element, field);

  if (!targetEl) {
    return field.defaultValue !== undefined ? field.defaultValue : null;
  }

  let rawValue: unknown;
  const extractor = (field.extractor || 'text').toLowerCase();

  if (extractor === 'table_cell') {
    return readTableCell(targetEl, field.columnIndex ?? 0) ?? field.defaultValue ?? null;
  }
  if (extractor === 'link_text') {
    const text = normalizeText(targetEl.textContent);
    return (
      text ||
      normalizeText(targetEl.getAttribute('aria-label')) ||
      normalizeText(targetEl.querySelector('img[alt]')?.getAttribute('alt')) ||
      normalizeText(targetEl.getAttribute('title')) ||
      field.defaultValue ||
      null
    );
  }

  switch (extractor) {
    case 'text':
      rawValue = (targetEl as HTMLElement).innerText || targetEl.textContent;
      break;

    case 'attribute':
    case 'attributes':
      rawValue = field.attributeName ? targetEl.getAttribute(field.attributeName) : null;
      break;

    case 'href':
    case 'link':
    case 'links':
      rawValue = targetEl.getAttribute('href') || targetEl.getAttribute('data-href');
      break;

    case 'src':
    case 'image':
    case 'images':
      rawValue =
        targetEl.getAttribute('src') ||
        targetEl.getAttribute('data-src') ||
        targetEl.getAttribute('data-lazy-src') ||
        targetEl.getAttribute('data-original');
      break;

    case 'html':
      rawValue = targetEl.innerHTML;
      break;

    case 'number':
    case 'numeric':
      rawValue = (targetEl as HTMLElement).innerText || targetEl.textContent;
      break;

    case 'price':
    case 'prices':
      rawValue = (targetEl as HTMLElement).innerText || targetEl.textContent;
      break;

    case 'date':
    case 'dates':
      rawValue = targetEl.getAttribute('datetime') || (targetEl as HTMLElement).innerText || targetEl.textContent;
      break;

    case 'boolean':
      rawValue = (targetEl as HTMLElement).innerText || targetEl.textContent;
      break;

    case 'regex':
      rawValue = (targetEl as HTMLElement).innerText || targetEl.textContent;
      break;

    default:
      rawValue = targetEl.textContent;
  }

  // A <base> tag changes what relative URLs mean, and only the element knows about it.
  const hasBaseTag = targetEl.ownerDocument?.querySelector('base[href]') != null;

  return normalizeFieldValue(rawValue, field.extractor as ExtendedFieldExtractorType, {
    baseUrl: hasBaseTag ? targetEl.baseURI : baseUrl,
    regexPattern: field.regexPattern,
    regexGroup: field.regexGroup,
    defaultValue: field.defaultValue,
    element: targetEl,
    attributeName: field.attributeName,
  });
}

/**
 * Alias for extractFieldValue matching single-field extraction semantics.
 */
export const extractSingleField = extractFieldValue;

/**
 * Normalizes field definitions from either explicit fields array, schema fields, or shorthand fieldSelectors / fieldTypes maps.
 */
type ResolvedFieldDefinition = ExtractionFieldConfig & { id: string };

function resolveFieldDefinitions(input: ExtractionInput): ResolvedFieldDefinition[] {
  const fieldsMap = new Map<string, ResolvedFieldDefinition>();

  // 1. If fieldSelectors map is provided
  if (input.fieldSelectors) {
    for (const [name, selector] of Object.entries(input.fieldSelectors)) {
      const extractor = (input.fieldTypes && input.fieldTypes[name]) || 'text';
      fieldsMap.set(name, {
        id: `f_${name}`,
        name,
        selector,
        extractor: normalizeExtractor(extractor),
        required: false,
        transform: 'trim',
      });
    }
  }

  // 2. If schema fields exist
  if (input.schema?.fields) {
    for (const f of input.schema.fields) {
      fieldsMap.set(f.name, {
        id: f.id || `f_${f.name}`,
        name: f.name,
        selector: f.selector,
        extractor: normalizeExtractor(f.extractor),
        attributeName: f.attributeName,
        regexPattern: f.regexPattern,
        regexGroup: f.regexGroup,
        defaultValue: f.defaultValue,
        required: f.required ?? false,
        transform: getFieldTransform(f),
        columnIndex: f.columnIndex,
      });
    }
  }

  // 3. If explicit fields array is provided, merge/augment
  if (input.fields && input.fields.length > 0) {
    for (const f of input.fields) {
      const existing = fieldsMap.get(f.name);
      fieldsMap.set(f.name, {
        id: f.id || existing?.id || `f_${f.name}`,
        name: f.name,
        selector: f.selector || existing?.selector || ':scope',
        extractor: normalizeExtractor(f.extractor || existing?.extractor || 'text'),
        attributeName: f.attributeName || existing?.attributeName,
        regexPattern: f.regexPattern || existing?.regexPattern,
        regexGroup: f.regexGroup !== undefined ? f.regexGroup : existing?.regexGroup,
        defaultValue: f.defaultValue !== undefined ? f.defaultValue : existing?.defaultValue,
        required: f.required !== undefined ? f.required : (existing?.required ?? false),
        transform: f.transform || existing?.transform || 'trim',
        columnIndex: f.columnIndex ?? existing?.columnIndex,
      });
    }
  }

  return Array.from(fieldsMap.values());
}

interface ExtractFromElementsOptions {
  pageNumber: number;
  baseUrl?: string;
  /** Signatures already seen in this run. When absent, no deduplication happens. */
  seen?: Set<string>;
  dedupeFields?: string[];
  /**
   * Remembers each element's last signature, so a list that keeps its earlier items
   * on the page (infinite scroll, load more) does not re-report them as duplicates.
   * Keyed by content as well as element, so a recycled virtualized row is re-read.
   */
  elementMemory?: WeakMap<Element, string>;
}

/**
 * Whether a later read of an element only added values to an earlier read. If any value
 * changed, the element now holds something else, as a recycled row in a long list does.
 */
function fillsInValues(previous: string, current: string): boolean {
  try {
    const before = JSON.parse(previous) as Array<[string, unknown]>;
    const after = new Map(JSON.parse(current) as Array<[string, unknown]>);
    return after.size > before.length && before.every(([key, value]) => after.get(key) === value);
  } catch {
    return false;
  }
}

function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

/**
 * The single extraction loop used by every path.
 *
 * A selected field with no value never removes a record: the record is kept with an
 * empty value and counted. Only a field the user explicitly marked as required can
 * exclude a record, and that exclusion is always counted.
 */
function extractFromElements(
  containers: Element[],
  fields: Array<FieldDefinition | ExtractionField | ExtractionFieldConfig>,
  options: ExtractFromElementsOptions
): ExtractionResult & { fieldHits: Record<string, number> } {
  const { pageNumber, baseUrl, seen, dedupeFields, elementMemory } = options;
  const records: ExtractedRecord[] = [];
  const errors: ExtractionJobError[] = [];
  const detector = seen ? new DuplicateDetector(seen) : null;
  const fieldHits: Record<string, number> = {};
  for (const field of fields) fieldHits[field.name] = 0;

  let duplicatesCount = 0;
  let totalParsed = 0;
  let missingFieldCount = 0;
  let filteredCount = 0;
  let failedCount = 0;

  for (let i = 0; i < containers.length; i++) {
    const container = containers[i];
    try {
      const record: Record<string, unknown> = {};
      const missing: string[] = [];
      const valueNotes: Record<string, NumberParseResult> = {};

      for (const field of fields) {
        if (field.selector && !isValidCssSelector(field.selector)) {
          errors.push({
            code: 'INVALID_SELECTOR',
            message: `Invalid selector "${field.selector}" for field "${field.name}".`,
            field: field.name,
            selector: field.selector,
            containerIndex: i,
            severity: 'WARN',
            recoverable: true,
            timestamp: Date.now(),
          });
          record[field.name] = field.defaultValue !== undefined ? field.defaultValue : null;
        } else {
          if (isNumberField(field)) {
            const { value, note } = readNumberField(container, field);
            record[field.name] = value;
            if (note) valueNotes[field.name] = note;
          } else {
            record[field.name] = extractFieldValue(container, field, baseUrl);
          }
        }

        if (isEmptyValue(record[field.name])) {
          missing.push(field.name);
        } else {
          fieldHits[field.name] += 1;
        }
      }

      const signature = generateRecordSignature(record);
      const previous = elementMemory?.get(container);
      if (previous === signature) {
        continue;
      }
      elementMemory?.set(container, signature);
      // An image or price that loaded late is the same row, not another one.
      const supersedes = previous !== undefined && fillsInValues(previous, signature) ? previous : undefined;
      if (!supersedes) totalParsed++;

      const validation = validateRecord(record, fields, i);
      if (!validation.isValid) {
        errors.push(...validation.errors);
        filteredCount++;
        continue;
      }

      if (detector?.process(record, dedupeFields).isDuplicate) {
        duplicatesCount++;
        continue;
      }

      if (missing.length > 0) {
        missingFieldCount++;
      }
      records.push({
        _id: `rec_${pageNumber}_${i}_${Date.now()}`,
        _page: pageNumber,
        _extractedAt: Date.now(),
        ...(record as Record<string, ExtractedRecord[string]>),
        ...(missing.length > 0 ? { _missingFields: missing.join(', ') } : {}),
        ...(Object.keys(valueNotes).length > 0 ? { _valueNotes: JSON.stringify(valueNotes) } : {}),
        ...(supersedes ? { _supersedes: supersedes } : {}),
      });
    } catch (error: unknown) {
      totalParsed++;
      failedCount++;
      errors.push({
        code: 'RECORD_EXTRACTION_FAILED',
        message: error instanceof Error ? error.message : String(error),
        containerIndex: i,
        severity: 'ERROR',
        recoverable: true,
        timestamp: Date.now(),
      });
    }
  }

  return {
    records,
    duplicatesCount,
    totalParsed,
    missingFieldCount,
    filteredCount,
    failedCount,
    errors,
    fieldHits,
  };
}

/**
 * Extracts structured records from an array of matched container elements.
 */
export function extractRecordsFromContainers(
  containers: Element[],
  fields: Array<FieldDefinition | ExtractionField | ExtractionFieldConfig>,
  pageNumber: number = 1,
  seenSignatures?: Set<string>,
  baseUrl?: string,
  elementMemory?: WeakMap<Element, string>
): ExtractionResult {
  return extractFromElements(containers, fields, {
    pageNumber,
    baseUrl,
    seen: seenSignatures,
    elementMemory,
  });
}

/**
 * Extracts all matching records from a DOM scope according to an ExtractionRecipe.
 */
export function extractRecordsFromScope(
  root: Document | Element,
  recipe: ExtractionRecipe | ExtractionSchema,
  pageNumber: number = 1,
  baseUrl?: string
): ExtractedRecord[] {
  const containers = Array.from(root.querySelectorAll(recipe.containerSelector));
  const result = extractRecordsFromContainers(
    containers,
    recipe.fields as FieldDefinition[],
    pageNumber,
    undefined,
    baseUrl
  );
  return result.records;
}

/**
 * Deterministic, Reusable Extraction Engine.
 * Converts detected website structures into normalized structured records with full
 * diagnostic error collection, execution statistics, and deduplication.
 */
export class ExtractionEngine {
  /**
   * Primary extraction workflow method.
   * Input: Extraction schema / selectors / field configurations.
   * Output: Normalized records, execution metadata, error log, and complete statistics.
   */
  public extract(input: ExtractionInput): ExtractionOutput {
    const startTime = performance.now();
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const pageNumber = input.pageNumber ?? 1;
    const baseUrl = input.baseUrl || (typeof window !== 'undefined' ? window.location.href : 'http://localhost');
    const errors: ExtractionJobError[] = [];

    // 1. Resolve and validate container selector
    const containerSelector =
      input.repeatedItemSelector ||
      input.schema?.containerSelector ||
      '';

    const inputValidation = validateExtractionInput(input);
    if (inputValidation.errors.length > 0) {
      errors.push(...inputValidation.errors);
    }

    if (!inputValidation.isValid || !containerSelector) {
      return this.buildOutput(
        [],
        executionId,
        pageNumber,
        containerSelector,
        baseUrl,
        0,
        errors,
        0,
        0,
        0,
        {},
        performance.now() - startTime,
        input.rootSelector,
        input.metadata
      );
    }

    // 2. Resolve fields
    const fields = resolveFieldDefinitions(input);

    // 3. Resolve DOM root scope
    const rootDoc = input.root || (typeof document !== 'undefined' ? document : null);
    if (!rootDoc) {
      errors.push({
        code: 'NO_DOM_ROOT',
        message: 'No DOM document or element available for extraction.',
        severity: 'FATAL',
        recoverable: false,
        timestamp: Date.now(),
      });
      return this.buildOutput(
        [],
        executionId,
        pageNumber,
        containerSelector,
        baseUrl,
        fields.length,
        errors,
        0,
        0,
        0,
        {},
        performance.now() - startTime,
        input.rootSelector,
        input.metadata
      );
    }

    let searchScope: Element | Document = rootDoc;
    if (input.rootSelector) {
      try {
        const foundRoot = rootDoc.querySelector(input.rootSelector);
        if (foundRoot) {
          searchScope = foundRoot;
        } else {
          errors.push({
            code: 'ROOT_SELECTOR_NOT_FOUND',
            message: `Root selector "${input.rootSelector}" was not found in the DOM; fallback to document.`,
            selector: input.rootSelector,
            severity: 'WARN',
            recoverable: true,
            timestamp: Date.now(),
          });
        }
      } catch (err) {
        errors.push({
          code: 'INVALID_ROOT_SELECTOR',
          message: `Root selector "${input.rootSelector}" failed to execute: ${(err as Error).message}.`,
          selector: input.rootSelector,
          severity: 'WARN',
          recoverable: true,
          timestamp: Date.now(),
        });
      }
    }

    // 4. Query container elements
    let containers: Element[];
    try {
      containers = Array.from(searchScope.querySelectorAll(containerSelector));
    } catch (err) {
      errors.push({
        code: 'CONTAINER_QUERY_FAILED',
        message: `Querying containers with "${containerSelector}" failed: ${(err as Error).message}.`,
        selector: containerSelector,
        severity: 'FATAL',
        recoverable: false,
        timestamp: Date.now(),
      });
      return this.buildOutput(
        [],
        executionId,
        pageNumber,
        containerSelector,
        baseUrl,
        fields.length,
        errors,
        0,
        0,
        0,
        {},
        performance.now() - startTime,
        input.rootSelector,
        input.metadata
      );
    }

    // 5. Shared extraction loop with optional in-run deduplication
    const isDedupeEnabled = input.deduplication?.enabled !== false;
    const extraction = extractFromElements(containers, fields, {
      pageNumber,
      baseUrl,
      seen: isDedupeEnabled ? input.deduplication?.seenHashes || new Set<string>() : undefined,
      dedupeFields: input.deduplication?.fields,
    });
    const { records, totalParsed, duplicatesCount, fieldHits } = extraction;
    errors.push(...(extraction.errors ?? []));

    // 6. Compute field coverage
    const fieldCoverage: Record<string, { count: number; percent: number }> = {};
    for (const field of fields) {
      const hits = fieldHits[field.name] || 0;
      const percent = records.length > 0 ? Math.round((hits / records.length) * 100) : 0;
      fieldCoverage[field.name] = { count: hits, percent };
    }

    const durationMs = performance.now() - startTime;

    return this.buildOutput(
      records,
      executionId,
      pageNumber,
      containerSelector,
      baseUrl,
      fields.length,
      errors,
      containers.length,
      totalParsed,
      duplicatesCount,
      fieldCoverage,
      durationMs,
      input.rootSelector,
      input.metadata,
      extraction
    );
  }

  private buildOutput(
    records: ExtractedRecord[],
    executionId: string,
    pageNumber: number,
    containerSelector: string,
    baseUrl: string | undefined,
    fieldCount: number,
    errors: ExtractionJobError[],
    totalContainersFound: number,
    totalParsed: number,
    duplicatesCount: number,
    fieldCoverage: Record<string, { count: number; percent: number }>,
    durationMs: number,
    rootSelector?: string,
    context?: Record<string, unknown>,
    outcomes?: Pick<ExtractionResult, 'missingFieldCount' | 'filteredCount' | 'failedCount'>
  ): ExtractionOutput {
    const validRecordsCount = records.length;
    const failedRecordsCount = errors.filter((e) => e.severity === 'ERROR' && e.code === 'MISSING_REQUIRED_FIELD').length;
    const fieldsExtractedCount = Object.values(fieldCoverage).reduce((acc, curr) => acc + curr.count, 0);

    const metadata: ExtractionMetadata = {
      executionId,
      extractedAt: Date.now(),
      pageNumber,
      rootSelector,
      containerSelector,
      baseUrl,
      fieldCount,
      context,
    };

    const statistics: ExtractionStatistics = {
      totalContainersFound,
      totalParsed,
      validRecordsCount,
      duplicatesCount,
      failedRecordsCount,
      missingFieldRecordsCount: outcomes?.missingFieldCount ?? 0,
      filteredRecordsCount: outcomes?.filteredCount ?? 0,
      erroredRecordsCount: outcomes?.failedCount ?? 0,
      fieldsExtractedCount,
      durationMs,
      fieldCoverage,
    };

    return {
      records,
      metadata,
      errors,
      statistics,
      totalParsed,
      duplicatesCount,
    };
  }
}

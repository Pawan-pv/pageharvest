import { ExtractionRecipe, ExtractedRecord, FieldDefinition } from '@/types';
import { normalizeFieldValue } from './normalizer';
import { computeRecordHash } from './duplicate-detector';

/**
 * Extracts a field value directly from a DOM element according to field definition.
 */
export function extractFieldValue(
  element: Element | null,
  field: FieldDefinition,
  baseUrl?: string
): string | number | null {
  if (!element) {
    return field.defaultValue !== undefined ? field.defaultValue : null;
  }

  let rawValue: unknown = null;

  switch (field.extractor) {
    case 'text':
      rawValue = (element as HTMLElement).innerText || element.textContent;
      break;

    case 'attribute':
      rawValue = field.attributeName ? element.getAttribute(field.attributeName) : null;
      break;

    case 'href':
      rawValue = element.getAttribute('href');
      break;

    case 'src':
      rawValue = element.getAttribute('src') || element.getAttribute('data-src');
      break;

    case 'html':
      rawValue = element.innerHTML;
      break;

    case 'number':
    case 'regex':
      rawValue = (element as HTMLElement).innerText || element.textContent;
      break;

    default:
      rawValue = element.textContent;
  }

  return normalizeFieldValue(rawValue, field.extractor, {
    baseUrl,
    regexPattern: field.regexPattern,
    regexGroup: field.regexGroup,
    defaultValue: field.defaultValue
  });
}

/**
 * Extracts a single field value from a container DOM element using relative selector.
 */
export function extractSingleField(
  container: Element,
  field: FieldDefinition,
  baseUrl?: string
): string | number | null {
  let targetEl: Element | null = null;

  if (!field.selector || field.selector === '.' || field.selector === ':scope') {
    targetEl = container;
  } else {
    try {
      targetEl = container.querySelector(field.selector);
    } catch {
      targetEl = null;
    }
  }

  return extractFieldValue(targetEl, field, baseUrl);
}

export interface ContainerExtractionResult {
  records: ExtractedRecord[];
  totalParsed: number;
  duplicatesCount: number;
}

/**
 * Extracts records from a list of container elements, with optional deduplication and required field checks.
 */
export function extractRecordsFromContainers(
  containers: Element[],
  fields: FieldDefinition[],
  page: number = 1,
  seenHashes?: Set<string>,
  baseUrl?: string
): ContainerExtractionResult {
  const records: ExtractedRecord[] = [];
  let totalParsed = 0;
  let duplicatesCount = 0;

  for (const container of containers) {
    totalParsed++;
    const recordData: Record<string, unknown> = {};
    let missingRequired = false;

    for (const field of fields) {
      const val = extractSingleField(container, field, baseUrl);
      if (field.required && (val === null || val === '')) {
        missingRequired = true;
        break;
      }
      recordData[field.name] = val;
    }

    if (missingRequired) {
      continue;
    }

    const hash = computeRecordHash(recordData);
    if (seenHashes && seenHashes.has(hash)) {
      duplicatesCount++;
      continue;
    }

    if (seenHashes) {
      seenHashes.add(hash);
    }

    const id = `rec_${hash}_${Math.random().toString(36).substring(2, 6)}`;
    records.push({
      _id: id,
      _page: page,
      _extractedAt: Date.now(),
      ...recordData
    });
  }

  return {
    records,
    totalParsed,
    duplicatesCount
  };
}

/**
 * Convenience method to query container selector and extract records from a document root.
 */
export function extractFromDocument(
  containerSelector: string,
  fields: FieldDefinition[],
  pageNumber: number = 1,
  seenHashes?: Set<string>,
  root: Document | Element = document
): ExtractionResult {
  let containers: Element[] = [];
  try {
    containers = Array.from(root.querySelectorAll(containerSelector));
  } catch {
    containers = [];
  }

  const baseUrl = typeof window !== 'undefined' ? window.location.href : 'http://localhost';
  return extractRecordsFromContainers(containers, fields, pageNumber, seenHashes, baseUrl);
}

/**
 * Extracts all matching records from a DOM scope according to an ExtractionRecipe.
 */
export function extractRecordsFromScope(
  root: Document | Element,
  recipe: ExtractionRecipe,
  pageNumber: number = 1,
  baseUrl?: string
): ExtractedRecord[] {
  const containers = Array.from(root.querySelectorAll(recipe.containerSelector));
  const result = extractRecordsFromContainers(containers, recipe.fields, pageNumber, undefined, baseUrl);
  return result.records;
}

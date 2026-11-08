import { FieldDefinition, ExtractedRecord, ExtractionRecipe } from '@/types';
import { ExtractionField, ExtractionSchema, FieldTransform } from '@/shared/contracts';
import type { MultiAnchorSelector } from '@/shared/contracts/selector';

/**
 * Supported data types / extractors for the PageHarvest Extraction Engine.
 */
export type ExtendedFieldExtractorType =
  | 'text'
  | 'table_cell'
  | 'link_text'
  | 'link'
  | 'links'
  | 'href'
  | 'image'
  | 'images'
  | 'src'
  | 'attribute'
  | 'attributes'
  | 'price'
  | 'prices'
  | 'date'
  | 'dates'
  | 'number'
  | 'numeric'
  | 'boolean'
  | 'metadata'
  | 'html'
  | 'regex';

/**
 * Flexible field definition configuration supported by the ExtractionEngine.
 */
export interface ExtractionFieldConfig {
  id?: string;
  name: string;
  selector: string;
  extractor: ExtendedFieldExtractorType;
  attributeName?: string;
  regexPattern?: string;
  regexGroup?: number;
  defaultValue?: string;
  required?: boolean;
  transform?: FieldTransform;
  columnIndex?: number;
}

/**
 * Documented Input Contract for an extraction workflow.
 */
export interface ExtractionInput {
  /**
   * Pre-configured recipe or schema definition.
   */
  schema?: ExtractionRecipe | ExtractionSchema;

  /**
   * Root DOM element or document to search within.
   * Defaults to global `document` if available.
   */
  root?: Document | Element;

  /**
   * Optional CSS selector to scope extraction to a specific sub-tree.
   */
  rootSelector?: string;

  /**
   * CSS selector for the repeating item containers (e.g. '.product-card', 'table tr').
   */
  repeatedItemSelector?: string;

  /**
   * Multi-tier fallback ladder for the repeating containers. Applied when the
   * primary selector finds nothing on the page.
   */
  containerAnchor?: MultiAnchorSelector;

  /**
   * Shorthand map of field name to relative CSS selector (e.g. `{ name: '.title', price: '.price' }`).
   */
  fieldSelectors?: Record<string, string>;

  /**
   * Shorthand map of field name to extractor type (e.g. `{ name: 'text', price: 'price', rating: 'number' }`).
   */
  fieldTypes?: Record<string, ExtendedFieldExtractorType>;

  /**
   * Explicit array of detailed field definitions.
   */
  fields?: Array<ExtractionFieldConfig | FieldDefinition | ExtractionField>;

  /**
   * Current pagination page number (defaults to 1).
   */
  pageNumber?: number;

  /**
   * Base URL used for resolving relative URLs and image links.
   */
  baseUrl?: string;

  /**
   * Additional contextual metadata attached to all extracted records.
   */
  metadata?: Record<string, unknown>;

  /**
   * Deduplication configuration.
   */
  deduplication?: {
    enabled?: boolean;
    fields?: string[];
    /** Canonical record signatures already seen in this run (exact comparison, not hashes). */
    seenHashes?: Set<string>;
  };

  /**
   * Record validation configuration.
   */
  validation?: {
    validateRequired?: boolean;
    strict?: boolean;
  };
}

/**
 * Coverage metrics for an individual extracted column.
 */
export interface FieldCoverageMetric {
  count: number;
  percent: number;
}

/**
 * Real-time extraction execution statistics.
 */
export interface ExtractionStatistics {
  totalContainersFound: number;
  totalParsed: number;
  validRecordsCount: number;
  duplicatesCount: number;
  failedRecordsCount: number;
  missingFieldRecordsCount: number;
  filteredRecordsCount: number;
  erroredRecordsCount: number;
  fieldsExtractedCount: number;
  durationMs: number;
  fieldCoverage: Record<string, FieldCoverageMetric>;
}

/**
 * Structured diagnostic error record collected during extraction.
 */
export interface ExtractionJobError {
  code: string;
  message: string;
  field?: string;
  selector?: string;
  containerIndex?: number;
  severity: 'WARN' | 'ERROR' | 'FATAL';
  recoverable: boolean;
  timestamp: number;
}

/**
 * Execution provenance metadata.
 */
export interface ExtractionMetadata {
  executionId: string;
  extractedAt: number;
  pageNumber: number;
  rootSelector?: string;
  containerSelector: string;
  baseUrl?: string;
  fieldCount: number;
  context?: Record<string, unknown>;
}

/**
 * Documented Output Contract for an extraction workflow.
 */
export interface ExtractionOutput {
  /**
   * Successfully extracted, normalized, and validated records.
   */
  records: ExtractedRecord[];

  /**
   * Provenance and execution metadata.
   */
  metadata: ExtractionMetadata;

  /**
   * All diagnostic warnings or recoverable errors collected during extraction.
   */
  errors: ExtractionJobError[];

  /**
   * Comprehensive operational statistics.
   */
  statistics: ExtractionStatistics;

  /**
   * Backward-compatibility convenience properties.
   */
  totalParsed: number;
  duplicatesCount: number;
}

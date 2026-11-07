import { FieldDefinition } from './field';
import type { MultiAnchorSelector } from '@/shared/contracts/selector';

export type PaginationType = 'none' | 'next_button' | 'infinite_scroll' | 'url_template';

export interface ExtractionPaginationConfig {
  type: PaginationType;
  nextButtonSelector?: string;
  maxPages?: number;
  maxRecords?: number;
  delayMs?: number;
  scrollCount?: number;
  scrollDelayMs?: number;
  urlTemplate?: string;
  startPage?: number;
  pageIncrement?: number;
  stopCondition?: 'no_new_records' | 'button_disabled' | 'max_reached';
}

export type PaginationConfig = ExtractionPaginationConfig;

export interface ExtractionRecipe {
  id: string;
  name: string;
  description?: string;
  projectId?: string;
  schemaId?: string;
  urlPattern: string;
  containerSelector: string;
  /** Multi-tier fallback ladder for the repeating item selector; optional for legacy recipes. */
  containerAnchor?: MultiAnchorSelector;
  fields: FieldDefinition[];
  pagination?: ExtractionPaginationConfig;
  dedupeFields?: string[];
  createdAt: number;
  updatedAt: number;
}

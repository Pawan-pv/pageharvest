import { FieldDefinition } from './field';

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
  fields: FieldDefinition[];
  pagination?: ExtractionPaginationConfig;
  dedupeFields?: string[];
  createdAt: number;
  updatedAt: number;
}

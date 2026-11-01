import { FieldDefinition } from './field';

export type PaginationType = 'none' | 'next_button' | 'infinite_scroll';

export interface ExtractionPaginationConfig {
  type: PaginationType;
  nextButtonSelector?: string;
  maxPages?: number;
  delayMs?: number;
  scrollCount?: number;
  scrollDelayMs?: number;
}

export type PaginationConfig = ExtractionPaginationConfig;

export interface ExtractionRecipe {
  id: string;
  name: string;
  urlPattern: string;
  containerSelector: string;
  fields: FieldDefinition[];
  pagination?: ExtractionPaginationConfig;
  createdAt: number;
  updatedAt: number;
}

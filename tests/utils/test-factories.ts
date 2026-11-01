import {
  FieldDefinition,
  ExtractionRecipe,
  ExtractedRecord,
  DatasetEntity,
  ExtractionRunHistory
} from '@/types';
import { ExtensionMessage } from '@/contracts';

export function createMockFieldDefinition(
  overrides: Partial<FieldDefinition> = {}
): FieldDefinition {
  return {
    id: `field_${Math.random().toString(36).substring(2, 9)}`,
    name: 'title',
    selector: '.product-title',
    extractor: 'text',
    required: false,
    ...overrides
  };
}

export function createMockRecipe(
  overrides: Partial<ExtractionRecipe> = {}
): ExtractionRecipe {
  return {
    id: `recipe_${Math.random().toString(36).substring(2, 9)}`,
    name: 'Sample E-commerce Scraper',
    urlPattern: 'https://example.com/products/*',
    containerSelector: '.product-card',
    fields: [
      createMockFieldDefinition({ id: 'f1', name: 'title', selector: '.product-title', extractor: 'text' }),
      createMockFieldDefinition({ id: 'f2', name: 'price', selector: '.product-price', extractor: 'number' }),
      createMockFieldDefinition({ id: 'f3', name: 'url', selector: '.product-link', extractor: 'href' })
    ],
    pagination: {
      type: 'next_button',
      nextButtonSelector: 'a.pagination-next',
      maxPages: 5,
      delayMs: 1000
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides
  };
}

export function createMockRecord(
  overrides: Partial<ExtractedRecord> = {}
): ExtractedRecord {
  return {
    _id: `rec_${Math.random().toString(36).substring(2, 9)}`,
    _page: 1,
    _extractedAt: Date.now(),
    title: 'Mechanical Keyboard RGB',
    price: 129.99,
    url: 'https://example.com/products/keyboard',
    ...overrides
  };
}

export function createMockDataset(
  overrides: Partial<DatasetEntity> = {}
): DatasetEntity {
  return {
    id: `dataset_${Math.random().toString(36).substring(2, 9)}`,
    name: 'Keyboards Dataset',
    url: 'https://example.com/products/keyboards',
    recordsCount: 3,
    fields: [
      createMockFieldDefinition({ name: 'title', selector: '.product-title', extractor: 'text' }),
      createMockFieldDefinition({ name: 'price', selector: '.product-price', extractor: 'number' })
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides
  };
}

export function createMockHistoryRun(
  overrides: Partial<ExtractionRunHistory> = {}
): ExtractionRunHistory {
  return {
    id: `run_${Math.random().toString(36).substring(2, 9)}`,
    datasetId: 'dataset_1',
    recipeId: 'recipe_1',
    status: 'COMPLETED',
    totalExtracted: 20,
    duplicatesSkipped: 2,
    startedAt: Date.now() - 5000,
    finishedAt: Date.now(),
    ...overrides
  };
}

export function createMockMessage<T extends ExtensionMessage['type']>(
  type: T,
  payload: unknown
): Extract<ExtensionMessage, { type: T }> {
  return {
    id: `msg_${Math.random().toString(36).substring(2, 9)}`,
    type,
    timestamp: Date.now(),
    payload
  } as Extract<ExtensionMessage, { type: T }>;
}

import { describe, it, expect } from 'vitest';
import {
  fieldDefinitionSchema,
  extractionRecipeSchema,
  extractedRecordSchema,
  datasetEntitySchema,
  harvestErrorSchema
} from '@/contracts/schemas';
import { createMockFieldDefinition, createMockRecipe } from '../utils/test-factories';

describe('Contracts & Schema Validation', () => {
  describe('fieldDefinitionSchema', () => {
    it('validates a standard text field definition', () => {
      const validField = createMockFieldDefinition({
        id: 'f1',
        name: 'title',
        selector: 'h2.title',
        extractor: 'text'
      });
      const parsed = fieldDefinitionSchema.parse(validField);
      expect(parsed.name).toBe('title');
      expect(parsed.extractor).toBe('text');
    });

    it('requires attributeName when extractor is "attribute"', () => {
      const invalidField = {
        id: 'f_attr',
        name: 'dataSku',
        selector: 'div.card',
        extractor: 'attribute'
        // missing attributeName
      };

      expect(() => fieldDefinitionSchema.parse(invalidField)).toThrow();
    });

    it('passes when attributeName is provided for "attribute" extractor', () => {
      const validAttrField = {
        id: 'f_attr',
        name: 'dataSku',
        selector: 'div.card',
        extractor: 'attribute' as const,
        attributeName: 'data-sku'
      };

      const parsed = fieldDefinitionSchema.parse(validAttrField);
      expect(parsed.attributeName).toBe('data-sku');
    });

    it('requires regexPattern when extractor is "regex"', () => {
      const invalidRegexField = {
        id: 'f_rx',
        name: 'code',
        selector: '.info',
        extractor: 'regex'
      };

      expect(() => fieldDefinitionSchema.parse(invalidRegexField)).toThrow();
    });

    it('rejects empty strings for id, name, and selector', () => {
      expect(() =>
        fieldDefinitionSchema.parse({
          id: '',
          name: 'title',
          selector: '.title',
          extractor: 'text'
        })
      ).toThrow();

      expect(() =>
        fieldDefinitionSchema.parse({
          id: 'f1',
          name: '',
          selector: '.title',
          extractor: 'text'
        })
      ).toThrow();

      expect(() =>
        fieldDefinitionSchema.parse({
          id: 'f1',
          name: 'title',
          selector: '',
          extractor: 'text'
        })
      ).toThrow();
    });
  });

  describe('extractionRecipeSchema', () => {
    it('validates a full recipe with fields and pagination config', () => {
      const recipe = createMockRecipe({
        name: 'Amazon Electronics',
        containerSelector: 'div.s-result-item',
        pagination: {
          type: 'next_button',
          nextButtonSelector: 'a.s-pagination-next',
          maxPages: 10,
          delayMs: 1500
        }
      });

      const parsed = extractionRecipeSchema.parse(recipe);
      expect(parsed.name).toBe('Amazon Electronics');
      expect(parsed.pagination?.type).toBe('next_button');
      expect(parsed.fields.length).toBe(3);
    });

    it('rejects recipes with empty fields array', () => {
      const emptyRecipe = createMockRecipe({
        fields: []
      });

      expect(() => extractionRecipeSchema.parse(emptyRecipe)).toThrow();
    });
  });

  describe('extractedRecordSchema', () => {
    it('validates records containing internal metadata and arbitrary fields', () => {
      const record = {
        _id: 'rec_1001',
        _page: 1,
        _extractedAt: 1700000000000,
        title: 'Mechanical Keyboard',
        price: 129.99,
        inStock: 'true',
        notes: null
      };

      const parsed = extractedRecordSchema.parse(record);
      expect(parsed._id).toBe('rec_1001');
      expect(parsed.title).toBe('Mechanical Keyboard');
      expect(parsed.price).toBe(129.99);
      expect(parsed.notes).toBeNull();
    });

    it('rejects records missing required metadata', () => {
      const invalid = {
        title: 'Only Title Without Metadata'
      };

      expect(() => extractedRecordSchema.parse(invalid)).toThrow();
    });
  });

  describe('datasetEntitySchema & harvestErrorSchema', () => {
    it('validates dataset metadata', () => {
      const dataset = {
        id: 'ds_01',
        name: 'Test Dataset',
        url: 'https://example.com/items',
        recordsCount: 42,
        fields: [createMockFieldDefinition()],
        createdAt: 1700000000000,
        updatedAt: 1700000001000
      };

      const parsed = datasetEntitySchema.parse(dataset);
      expect(parsed.id).toBe('ds_01');
      expect(parsed.recordsCount).toBe(42);
    });

    it('validates harvest error structures with categories and severity', () => {
      const error = {
        id: 'err_01',
        category: 'SELECTOR_NOT_FOUND' as const,
        severity: 'WARN' as const,
        message: 'Could not find .product-price',
        timestamp: Date.now(),
        context: { selector: '.product-price' }
      };

      const parsed = harvestErrorSchema.parse(error);
      expect(parsed.category).toBe('SELECTOR_NOT_FOUND');
      expect(parsed.severity).toBe('WARN');
    });
  });
});

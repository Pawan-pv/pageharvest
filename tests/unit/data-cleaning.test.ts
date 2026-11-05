import { describe, it, expect } from 'vitest';
import {
  removeDuplicates,
  removeEmptyRows,
  removeEmptyColumns,
  renameColumn,
  deleteColumns,
  reorderColumns,
  findAndReplace,
  trimWhitespace,
  normalizeValues,
  DataCleaningHistory,
} from '@/core/cleaning/data-cleaner';
import { ExtractedRecord, FieldDefinition } from '@/types';

describe('Data Cleaning & Normalization Engine', () => {
  const sampleFields: FieldDefinition[] = [
    { id: 'f1', name: 'title', selector: 'h2', extractor: 'text' },
    { id: 'f2', name: 'price', selector: '.price', extractor: 'number' },
    { id: 'f3', name: 'link', selector: 'a', extractor: 'href' },
    { id: 'f4', name: 'notes', selector: '.notes', extractor: 'text' },
  ];

  describe('removeDuplicates', () => {
    it('removes duplicate records across all user fields while preserving metadata', () => {
      const records: ExtractedRecord[] = [
        { _id: '1', _page: 1, _extractedAt: 100, title: 'MacBook Pro', price: 1999, link: 'https://apple.com/mbp' },
        { _id: '2', _page: 1, _extractedAt: 200, title: 'Dell XPS 15', price: 1799, link: 'https://dell.com/xps' },
        // Exact duplicate of row 1 (different _id and timestamp)
        { _id: '3', _page: 2, _extractedAt: 300, title: 'MacBook Pro', price: 1999, link: 'https://apple.com/mbp' },
      ];

      const { cleaned, duplicatesRemoved, removedRecords } = removeDuplicates(records);
      expect(cleaned.length).toBe(2);
      expect(duplicatesRemoved).toBe(1);
      expect(removedRecords[0]._id).toBe('3');
      expect(cleaned.map((r) => r.title)).toEqual(['MacBook Pro', 'Dell XPS 15']);
    });

    it('deduplicates based on specific key columns', () => {
      const records: ExtractedRecord[] = [
        { _id: '1', _page: 1, _extractedAt: 100, title: 'Laptop A', price: 1000, link: 'https://store1.com/a' },
        { _id: '2', _page: 1, _extractedAt: 200, title: 'Laptop A', price: 950, link: 'https://store2.com/a' },
      ];

      const { cleaned, duplicatesRemoved } = removeDuplicates(records, ['title']);
      expect(cleaned.length).toBe(1);
      expect(duplicatesRemoved).toBe(1);
      expect(cleaned[0]._id).toBe('1');
    });
  });

  describe('removeEmptyRows', () => {
    it('removes rows where all extracted data cells are empty or null', () => {
      const records: ExtractedRecord[] = [
        { _id: '1', _page: 1, _extractedAt: 100, title: 'Real Product', price: 50 },
        { _id: '2', _page: 1, _extractedAt: 200, title: '', price: null, link: undefined, notes: '   ' },
        { _id: '3', _page: 1, _extractedAt: 300, title: null, price: null },
      ];

      const { cleaned, emptyRowsRemoved } = removeEmptyRows(records, sampleFields);
      expect(cleaned.length).toBe(1);
      expect(emptyRowsRemoved).toBe(2);
      expect(cleaned[0].title).toBe('Real Product');
    });
  });

  describe('removeEmptyColumns', () => {
    it('detects and removes columns that have no values across any records', () => {
      const records: ExtractedRecord[] = [
        { _id: '1', _page: 1, _extractedAt: 100, title: 'Phone', price: 400, notes: null },
        { _id: '2', _page: 1, _extractedAt: 200, title: 'Tablet', price: 300, notes: '' },
      ];

      const { cleanedRecords, remainingFields, removedFields } = removeEmptyColumns(records, sampleFields);

      expect(removedFields.map((f) => f.name)).toContain('notes');
      expect(removedFields.map((f) => f.name)).toContain('link');
      expect(remainingFields.map((f) => f.name)).toEqual(['title', 'price']);

      // Ensure stripped keys from records
      expect(cleanedRecords[0].notes).toBeUndefined();
      expect(cleanedRecords[0].link).toBeUndefined();
      expect(cleanedRecords[0].title).toBe('Phone');
    });
  });

  describe('renameColumn', () => {
    it('renames a column in field definitions and record keys', () => {
      const records: ExtractedRecord[] = [
        { _id: '1', _page: 1, _extractedAt: 100, title: 'Coffee Maker', price: 80 },
      ];

      const { records: updatedRecords, fields: updatedFields } = renameColumn(
        records,
        sampleFields,
        'title',
        'productName'
      );

      expect(updatedFields.find((f) => f.name === 'productName')).toBeDefined();
      expect(updatedFields.find((f) => f.name === 'title')).toBeUndefined();
      expect(updatedRecords[0]['productName']).toBe('Coffee Maker');
      expect(updatedRecords[0]['title']).toBeUndefined();
    });

    it('rejects renaming to existing column or empty name', () => {
      const records: ExtractedRecord[] = [{ _id: '1', _page: 1, _extractedAt: 100, title: 'Item', price: 10 }];

      expect(() => renameColumn(records, sampleFields, 'title', 'price')).toThrow();
      expect(() => renameColumn(records, sampleFields, 'title', '')).toThrow();
    });
  });

  describe('deleteColumns', () => {
    it('deletes specified columns from schema and record properties', () => {
      const records: ExtractedRecord[] = [
        { _id: '1', _page: 1, _extractedAt: 100, title: 'Book', price: 15, link: 'https://book.com' },
      ];

      const { records: updatedRecords, fields: updatedFields, removedFields } = deleteColumns(
        records,
        sampleFields,
        ['link', 'notes']
      );

      expect(removedFields.length).toBe(2);
      expect(updatedFields.map((f) => f.name)).toEqual(['title', 'price']);
      expect(updatedRecords[0]['link']).toBeUndefined();
      expect(updatedRecords[0]['title']).toBe('Book');
    });
  });

  describe('reorderColumns', () => {
    it('reorders fields according to specified column order', () => {
      const newOrder = ['price', 'title', 'link', 'notes'];
      const reordered = reorderColumns(sampleFields, newOrder);

      expect(reordered.map((f) => f.name)).toEqual(newOrder);
    });
  });

  describe('findAndReplace', () => {
    it('replaces substrings in target column with count', () => {
      const records: ExtractedRecord[] = [
        { _id: '1', _page: 1, _extractedAt: 100, title: 'Old Model 2020', notes: 'Old stock' },
        { _id: '2', _page: 1, _extractedAt: 200, title: 'Old Model 2021', notes: 'New condition' },
      ];

      const { records: updated, replacementsCount } = findAndReplace(records, {
        find: 'Old Model',
        replace: 'Vintage Edition',
        column: 'title',
      });

      expect(replacementsCount).toBe(2);
      expect(updated[0].title).toBe('Vintage Edition 2020');
      expect(updated[1].title).toBe('Vintage Edition 2021');
      // Notes should be untouched when target column is title
      expect(updated[0].notes).toBe('Old stock');
    });

    it('supports case-insensitivity and global replacement across all columns', () => {
      const records: ExtractedRecord[] = [
        { _id: '1', _page: 1, _extractedAt: 100, title: 'discount voucher', notes: 'DISCOUNT applied' },
      ];

      const { records: updated, replacementsCount } = findAndReplace(records, {
        find: 'discount',
        replace: 'Sale',
        matchCase: false,
      });

      expect(replacementsCount).toBe(2);
      expect(updated[0].title).toBe('Sale voucher');
      expect(updated[0].notes).toBe('Sale applied');
    });
  });

  describe('trimWhitespace', () => {
    it('trims leading/trailing spaces and collapses excessive tabs and newlines', () => {
      const records: ExtractedRecord[] = [
        { _id: '1', _page: 1, _extractedAt: 100, title: '  Smart   Watch \n ', notes: '\tBrand new \t' },
      ];

      const { records: updated, cellsModified } = trimWhitespace(records);
      expect(cellsModified).toBe(2);
      expect(updated[0].title).toBe('Smart Watch');
      expect(updated[0].notes).toBe('Brand new');
    });
  });

  describe('normalizeValues', () => {
    it('normalizes currency strings to numbers ($1,299.99 -> 1299.99)', () => {
      const records: ExtractedRecord[] = [
        { _id: '1', _page: 1, _extractedAt: 100, rawPrice: '$1,299.99' },
        { _id: '2', _page: 1, _extractedAt: 200, rawPrice: '€ 49.50' },
      ];

      const { records: updated } = normalizeValues(records, 'rawPrice', 'number');
      expect(updated[0].rawPrice).toBe(1299.99);
      expect(updated[1].rawPrice).toBe(49.5);
    });

    it('normalizes casing (uppercase, lowercase, titlecase)', () => {
      const records: ExtractedRecord[] = [
        { _id: '1', _page: 1, _extractedAt: 100, title: 'apple macbook pro' },
      ];

      const upper = normalizeValues(records, 'title', 'uppercase').records;
      expect(upper[0].title).toBe('APPLE MACBOOK PRO');

      const title = normalizeValues(records, 'title', 'titlecase').records;
      expect(title[0].title).toBe('Apple Macbook Pro');
    });

    it('resolves relative URLs to absolute', () => {
      const records: ExtractedRecord[] = [
        { _id: '1', _page: 1, _extractedAt: 100, link: '/product/101' },
      ];

      const { records: updated } = normalizeValues(records, 'link', 'url', 'https://example.com/shop');
      expect(updated[0].link).toBe('https://example.com/product/101');
    });
  });

  describe('DataCleaningHistory (Undo / Redo Stack)', () => {
    it('supports undoing and redoing data cleaning operations cleanly', () => {
      const initialRecords: ExtractedRecord[] = [
        { _id: '1', _page: 1, _extractedAt: 100, title: 'Item 1' },
        { _id: '2', _page: 1, _extractedAt: 200, title: 'Item 1' },
      ];
      const history = new DataCleaningHistory(initialRecords, sampleFields);

      expect(history.canUndo()).toBe(false);
      expect(history.canRedo()).toBe(false);

      // Perform deduplication
      const { cleaned } = removeDuplicates(history.currentRecords);
      history.recordOperation({
        description: 'Remove duplicates',
        previousRecords: history.currentRecords,
        previousFields: history.currentFields,
        nextRecords: cleaned,
        nextFields: history.currentFields,
        isDestructive: false,
      });

      expect(history.currentRecords.length).toBe(1);
      expect(history.canUndo()).toBe(true);
      expect(history.canRedo()).toBe(false);

      // Undo operation
      const undone = history.undo();
      expect(undone).toBe(true);
      expect(history.currentRecords.length).toBe(2);
      expect(history.canUndo()).toBe(false);
      expect(history.canRedo()).toBe(true);

      // Redo operation
      const redone = history.redo();
      expect(redone).toBe(true);
      expect(history.currentRecords.length).toBe(1);
      expect(history.canUndo()).toBe(true);
      expect(history.canRedo()).toBe(false);
    });

    it('flags destructive operations requiring user confirmation', () => {
      const history = new DataCleaningHistory([], sampleFields);
      const requiresConfirm = history.isOperationDestructive('DELETE_COLUMNS');
      expect(requiresConfirm).toBe(true);

      const nonDestructive = history.isOperationDestructive('TRIM_WHITESPACE');
      expect(nonDestructive).toBe(false);
    });

    it('evicts oldest snapshots when the default cap (20) is reached', () => {
      const initialRecords: ExtractedRecord[] = [
        { _id: '1', _page: 1, _extractedAt: 100, title: 'Item 1' },
      ];
      const history = new DataCleaningHistory(initialRecords, sampleFields);

      // Perform 25 operations (default cap is 20)
      for (let i = 0; i < 25; i++) {
        const nextRecords = [...history.currentRecords, { _id: `new-${i}`, _page: 1, _extractedAt: 200 + i, title: `Item ${i}` }];
        history.recordOperation({
          description: `Op ${i}`,
          previousRecords: history.currentRecords,
          previousFields: history.currentFields,
          nextRecords,
          nextFields: history.currentFields,
        });
      }

      // Should have at most 20 snapshots
      expect(history.getUndoHistory().length).toBeLessThanOrEqual(20);
      // Oldest (Op 0) should have been evicted
      expect(history.getUndoHistory()[0].description).not.toBe('Op 0');
      // Most recent should be present
      expect(history.getUndoHistory()[history.getUndoHistory().length - 1].description).toBe('Op 24');
    });

    it('uses a smaller cap (5) for datasets over 5,000 records', () => {
      const largeRecords: ExtractedRecord[] = [];
      for (let i = 0; i < 6000; i++) {
        largeRecords.push({ _id: `r${i}`, _page: 1, _extractedAt: 100, title: `Item ${i}` });
      }
      const history = new DataCleaningHistory(largeRecords, sampleFields);

      // Cap should be 5 for large datasets
      for (let i = 0; i < 10; i++) {
        const nextRecords = [...history.currentRecords];
        history.recordOperation({
          description: `Op ${i}`,
          previousRecords: history.currentRecords,
          previousFields: history.currentFields,
          nextRecords,
          nextFields: history.currentFields,
        });
      }

      expect(history.getUndoHistory().length).toBeLessThanOrEqual(5);
    });

    it('dynamically lowers the cap mid-session when records grow past 5,000', () => {
      // Start small: default cap is 20
      const initialRecords: ExtractedRecord[] = [
        { _id: '1', _page: 1, _extractedAt: 100, title: 'Item 1' },
      ];
      const history = new DataCleaningHistory(initialRecords, sampleFields);

      // Perform 25 operations with small records — cap stays at 20
      for (let i = 0; i < 25; i++) {
        const nextRecords = [...history.currentRecords, { _id: `new-${i}`, _page: 1, _extractedAt: 200 + i, title: `Item ${i}` }];
        history.recordOperation({
          description: `small-op-${i}`,
          previousRecords: history.currentRecords,
          previousFields: history.currentFields,
          nextRecords,
          nextFields: history.currentFields,
        });
      }
      expect(history.getUndoHistory().length).toBeLessThanOrEqual(20);

      // Now grow the dataset past 5,000 records in one operation
      const manyRecords: ExtractedRecord[] = [];
      for (let i = 0; i < 6000; i++) {
        manyRecords.push({ _id: `big-${i}`, _page: 1, _extractedAt: 300, title: `Big Item ${i}` });
      }
      history.recordOperation({
        description: 'grow-to-large',
        previousRecords: history.currentRecords,
        previousFields: history.currentFields,
        nextRecords: manyRecords,
        nextFields: history.currentFields,
      });

      // Cap should now drop to 5 and the stack should be trimmed
      expect(history.getUndoHistory().length).toBeLessThanOrEqual(5);
      // The most recent operation (grow-to-large) should be present
      expect(history.getUndoHistory()[history.getUndoHistory().length - 1].description).toBe('grow-to-large');
    });

    it('allows a custom history cap to be passed', () => {
      const initialRecords: ExtractedRecord[] = [
        { _id: '1', _page: 1, _extractedAt: 100, title: 'Item 1' },
      ];
      const history = new DataCleaningHistory(initialRecords, sampleFields, 3);

      for (let i = 0; i < 5; i++) {
        const nextRecords = [...history.currentRecords, { _id: `new-${i}`, _page: 1, _extractedAt: 200 + i, title: `Item ${i}` }];
        history.recordOperation({
          description: `Op ${i}`,
          previousRecords: history.currentRecords,
          previousFields: history.currentFields,
          nextRecords,
          nextFields: history.currentFields,
        });
      }

      expect(history.getUndoHistory().length).toBeLessThanOrEqual(3);
    });
  });
});

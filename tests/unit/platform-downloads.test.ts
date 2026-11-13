import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createChromeMock, ChromeMock } from '../utils/chrome-mock';
import {
  sanitizeFilename,
  triggerDownload,
  waitForSavedFile,
  showInFolder,
  DownloadOptions
} from '@/platform/downloads';

describe('Downloads Platform Integration', () => {
  let mockChrome: ChromeMock;

  beforeEach(() => {
    mockChrome = createChromeMock();
    Reflect.set(globalThis, 'chrome', mockChrome);
  });

  describe('sanitizeFilename', () => {
    it('removes invalid filesystem characters', () => {
      expect(sanitizeFilename('my:bad/file*name?.csv')).toBe('my_bad_file_name_.csv');
      expect(sanitizeFilename('file<with>quotes"and|pipes.json')).toBe('file_with_quotes_and_pipes.json');
    });

    it('preserves clean filenames', () => {
      expect(sanitizeFilename('amazon-laptops-2026.csv')).toBe('amazon-laptops-2026.csv');
      expect(sanitizeFilename('harvested_data.json')).toBe('harvested_data.json');
    });

    it('falls back to default filename when empty or whitespace', () => {
      expect(sanitizeFilename('')).toBe('pageharvest_export.csv');
      expect(sanitizeFilename('   ')).toBe('pageharvest_export.csv');
    });
  });

  describe('triggerDownload', () => {
    it('saves straight to the Downloads folder, with no "Save as" window, and keeps both files on a name clash', async () => {
      const options: DownloadOptions = {
        filename: 'products:sale.csv',
        content: 'Title,Price\n"Laptop",999.99',
        mimeType: 'text/csv'
      };

      const result = await triggerDownload(options);
      expect(result).toEqual({ success: true, downloadId: 12345 });
      expect(mockChrome.downloads.download).toHaveBeenCalled();

      const callArgs = mockChrome.downloads.download.mock.calls[0][0];
      expect(callArgs.filename).toBe('products_sale.csv');
      expect(callArgs.saveAs).toBe(false);
      // A second download of the same list must not replace the first file.
      expect(callArgs.conflictAction).toBe('uniquify');
      expect(callArgs.url).toMatch(/^(data:|blob:)/);
    });

    it('handles download failure gracefully and reports error', async () => {
      mockChrome.downloads.download = vi.fn().mockRejectedValue(new Error('User cancelled download'));

      const options: DownloadOptions = {
        filename: 'data.json',
        content: '{"items":[]}',
        mimeType: 'application/json'
      };

      const result = await triggerDownload(options);
      expect(result.success).toBe(false);
      expect(result.error).toContain('User cancelled download');
      expect(result.downloadId).toBeUndefined();
    });

    it('does not report success when Chrome returns no download', async () => {
      mockChrome.downloads.download = vi.fn().mockResolvedValue(undefined);
      const result = await triggerDownload({ filename: 'a.csv', content: 'a', mimeType: 'text/csv' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/did not start/i);
    });

    it('accepts string array content and creates a Blob from chunks', async () => {
      const options: DownloadOptions = {
        filename: 'products.csv',
        content: ['Title,Price\n', '"Laptop",999.99\n'],
        mimeType: 'text/csv',
      };

      const result = await triggerDownload(options);
      expect(result.success).toBe(true);
      expect(mockChrome.downloads.download).toHaveBeenCalled();

      const callArgs = mockChrome.downloads.download.mock.calls[0][0];
      expect(callArgs.filename).toBe('products.csv');
      expect(callArgs.saveAs).toBe(false);
      expect(callArgs.url).toMatch(/^(blob:|data:)/);
    });
  });

  describe('waitForSavedFile', () => {
    it('reports the name Chrome really saved the file under, without its folder', async () => {
      // Chrome renamed the file because "books.xlsx" was already there.
      mockChrome.downloadItems.set(7, { id: 7, state: 'complete', filename: 'C:\\Users\\someone\\Downloads\\books (1).xlsx' });
      expect(await waitForSavedFile(7)).toEqual({ state: 'complete', fileName: 'books (1).xlsx' });
    });

    it('reads a name from a path with forward slashes too', async () => {
      mockChrome.downloadItems.set(8, { id: 8, state: 'complete', filename: '/home/someone/Downloads/books.csv' });
      expect(await waitForSavedFile(8)).toEqual({ state: 'complete', fileName: 'books.csv' });
    });

    it('waits while Chrome is still writing, and reports the file once it is complete', async () => {
      mockChrome.downloadItems.set(9, { id: 9, state: 'in_progress', filename: '' });
      const pending = waitForSavedFile(9, { timeoutMs: 2000, pollMs: 10 });
      setTimeout(() => {
        mockChrome.downloadItems.set(9, { id: 9, state: 'complete', filename: 'C:\\d\\rows.xlsx' });
      }, 40);
      expect(await pending).toEqual({ state: 'complete', fileName: 'rows.xlsx' });
    });

    it('says why a file was not saved, in plain words', async () => {
      mockChrome.downloadItems.set(10, { id: 10, state: 'interrupted', error: 'FILE_NO_SPACE', filename: '' });
      expect(await waitForSavedFile(10)).toEqual({ state: 'interrupted', reason: 'The disk is full.' });

      mockChrome.downloadItems.set(11, { id: 11, state: 'interrupted', error: 'USER_CANCELED', filename: '' });
      expect(await waitForSavedFile(11)).toEqual({ state: 'interrupted', reason: 'The download was cancelled.' });
    });

    it('never claims a file is saved when Chrome has not finished in time', async () => {
      mockChrome.downloadItems.set(12, { id: 12, state: 'in_progress', filename: '' });
      expect(await waitForSavedFile(12, { timeoutMs: 60, pollMs: 10 })).toEqual({ state: 'in_progress' });
    });

    it('never claims a file is saved when Chrome cannot be asked', async () => {
      mockChrome.downloads.search = vi.fn().mockRejectedValue(new Error('no'));
      expect(await waitForSavedFile(13, { timeoutMs: 40, pollMs: 10 })).toEqual({ state: 'in_progress' });
    });
  });

  describe('showInFolder', () => {
    it('asks Chrome to open the folder with the file selected', () => {
      expect(showInFolder(7)).toBe(true);
      expect(mockChrome.downloads.show).toHaveBeenCalledWith(7);
    });

    it('reports when the folder could not be opened, instead of throwing', () => {
      mockChrome.downloads.show = vi.fn(() => {
        throw new Error('gone');
      });
      expect(showInFolder(7)).toBe(false);
    });
  });
});

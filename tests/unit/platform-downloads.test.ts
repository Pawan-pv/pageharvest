import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createChromeMock, ChromeMock } from '../utils/chrome-mock';
import {
  sanitizeFilename,
  triggerDownload,
  DownloadOptions
} from '@/platform/downloads';

describe('Downloads Platform Integration', () => {
  let mockChrome: ChromeMock;

  beforeEach(() => {
    mockChrome = createChromeMock();
    (globalThis as any).chrome = mockChrome;
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
    it('initiates chrome.downloads.download with sanitized filename and blob/data URL', async () => {
      const options: DownloadOptions = {
        filename: 'products:sale.csv',
        content: 'Title,Price\n"Laptop",999.99',
        mimeType: 'text/csv'
      };

      const result = await triggerDownload(options);
      expect(result.success).toBe(true);
      expect(mockChrome.downloads.download).toHaveBeenCalled();

      const callArgs = mockChrome.downloads.download.mock.calls[0][0];
      expect(callArgs.filename).toBe('products_sale.csv');
      expect(callArgs.saveAs).toBe(true);
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
    });
  });
});

import { describe, it, expect } from 'vitest';
import {
  extractImageExtension,
  parseSrcset,
  sanitizeFilenamePart,
  interpolateFilenameTemplate,
} from '@/core/images/image-utils';
import { ImageDownloaderRunner } from '@/background/runners/image-downloader-runner';

describe('Image Downloader Utilities', () => {
  it('extracts correct file extensions from URLs', () => {
    expect(extractImageExtension('https://example.com/photo.png')).toBe('png');
    expect(extractImageExtension('https://example.com/banner.jpeg?width=800')).toBe('jpg');
    expect(extractImageExtension('https://example.com/vector.svg#icon')).toBe('svg');
    expect(extractImageExtension('https://example.com/asset?id=123')).toBe('jpg');
  });

  it('parses srcset attributes and picks the highest resolution image', () => {
    const srcset = `
      /images/thumb-100.jpg 100w,
      /images/medium-400.jpg 400w,
      /images/large-1200.jpg 1200w,
      /images/regular-200.jpg 200w
    `;
    expect(parseSrcset(srcset)).toBe('/images/large-1200.jpg');

    const densitySrcset = 'pic.jpg 1x, pic-2x.jpg 2x';
    expect(parseSrcset(densitySrcset)).toBe('pic-2x.jpg');
  });

  it('sanitizes filename components against illegal characters and traversal', () => {
    expect(sanitizeFilenamePart('product: "super / cool" <special>?')).toBe('product_super_cool_special');
    expect(sanitizeFilenamePart('../../etc/passwd')).toBe('etc_passwd');
    expect(sanitizeFilenamePart('trailing space and dot. ')).toBe('trailing_space_and_dot');
  });

  it('interpolates filename template with built-in and dataset record tokens', () => {
    const template = 'PageHarvest/{domain}/{Vendor}-{index}.{ext}';
    const result = interpolateFilenameTemplate(template, {
      index: 4,
      domain: 'mystore.com',
      ext: 'webp',
      record: {
        Vendor: 'Nike Shoes',
      },
    });

    expect(result).toBe('PageHarvest/mystore.com/Nike_Shoes-005.webp');
  });

  it('runs paced downloads with progress reporting and cancellation', async () => {
    const downloaded: string[] = [];
    const runner = new ImageDownloaderRunner({
      targets: [
        { url: 'https://cdn.example.com/1.jpg', filename: '1.jpg' },
        { url: 'https://cdn.example.com/2.jpg', filename: '2.jpg' },
        { url: 'https://cdn.example.com/3.jpg', filename: '3.jpg' },
      ],
      minDelayMs: 10,
      downloadFn: async ({ filename }) => {
        downloaded.push(filename);
        return 1;
      },
    });

    await runner.start();
    expect(downloaded).toEqual(['1.jpg', '2.jpg', '3.jpg']);
    expect(runner.getStatus()).toBe('completed');
  });
});

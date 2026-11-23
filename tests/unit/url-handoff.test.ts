import { describe, it, expect, beforeEach } from 'vitest';
import { createChromeMock, ChromeMock } from '../utils/chrome-mock';
import {
  clearUrlHandoff,
  dedupeUrls,
  handOffUrls,
  readUrlHandoff,
  storeUrlHandoff,
} from '@/platform/url-handoff';
import type { ToolType } from '@/shared/contracts/tool-job';

describe('dedupeUrls', () => {
  it('trims, validates, de-duplicates and keeps order', () => {
    expect(
      dedupeUrls(['  https://example.com/a ', 'https://example.com/a', 'https://example.com/b', 'not-a-url', '', null, 'ftp://x'])
    ).toEqual(['https://example.com/a', 'https://example.com/b']);
  });
});

describe('url handoff storage', () => {
  let mockChrome: ChromeMock;

  beforeEach(() => {
    mockChrome = createChromeMock();
    Reflect.set(globalThis, 'chrome', mockChrome);
  });

  it('stores, reads, and clears a handoff through chrome.storage.session', async () => {
    const handoff = {
      tool: 'links' as ToolType,
      urls: ['https://example.com/a'],
      source: 'dataset_column' as const,
      datasetId: 'ds_1',
      column: 'URL',
      createdAt: 1,
    };

    await storeUrlHandoff(handoff);
    const key = `pageharvest:url-handoff:links`;
    const stored = (await chrome.storage.session.get(key))[key] as { urls: string[] };
    expect(stored.urls).toEqual(['https://example.com/a']);

    const read = await readUrlHandoff('links');
    expect(read).toMatchObject({ tool: 'links', urls: ['https://example.com/a'], datasetId: 'ds_1' });

    await clearUrlHandoff('links');
    const after = await readUrlHandoff('links');
    expect(after).toBeNull();
  });

  it('returns null when no handoff is stored', async () => {
    expect(await readUrlHandoff('shopify')).toBeNull();
  });
});

describe('handOffUrls', () => {
  let mockChrome: ChromeMock;

  beforeEach(() => {
    mockChrome = createChromeMock();
    Reflect.set(globalThis, 'chrome', mockChrome);
  });

  it('dedupes, stores, and returns the URL list', async () => {
    const result = await handOffUrls({
      tool: 'table',
      urls: ['https://example.com/a', 'https://example.com/a', 'https://example.com/b'],
      source: 'dataset_column',
      datasetId: 'ds_1',
      column: 'URL',
    });

    expect(result.urls).toEqual(['https://example.com/a', 'https://example.com/b']);
    const stored = await readUrlHandoff('table');
    expect(stored?.urls).toEqual(['https://example.com/a', 'https://example.com/b']);
    expect(stored?.datasetId).toBe('ds_1');
    expect(stored?.column).toBe('URL');
  });

  it('throws when there are no valid web addresses', async () => {
    await expect(
      handOffUrls({ tool: 'links', urls: ['not a url', '', 'ftp://x'] })
    ).rejects.toThrow(/no web addresses/);
  });

  it('defaults the source to dataset_column', async () => {
    await handOffUrls({ tool: 'shopify', urls: ['https://example.com/a'] });
    const stored = await readUrlHandoff('shopify');
    expect(stored?.source).toBe('dataset_column');
  });
});

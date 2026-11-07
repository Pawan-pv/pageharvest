import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FieldPreviewResultSchema,
  PREVIEW_ROW_LIMIT,
  previewFieldsMessageSchema,
} from '@/shared/contracts/message';
import { ExtractionFieldSchema, type ExtractionField } from '@/shared/contracts/field';
import { messagingService } from '@/services/messaging';
import { ExtensionHarness, BASE_URL, makeRecipe, renderCards } from '../utils/job-harness';

const TAB = 9;
const title: ExtractionField = ExtractionFieldSchema.parse({
  id: 't',
  name: 'Title',
  selector: '.title',
  extractor: 'text',
});

function previewMessage(overrides: Record<string, unknown> = {}) {
  return previewFieldsMessageSchema.parse({
    id: 'preview_1',
    type: 'PREVIEW_FIELDS',
    timestamp: 1,
    payload: { containerSelector: '.card', fields: [title], limit: 3, ...overrides },
  });
}

describe('PREVIEW_FIELDS contract', () => {
  it('accepts a request of up to the row limit, and rejects more or no fields', () => {
    expect(previewMessage().payload.limit).toBe(3);
    expect(() => previewMessage({ limit: PREVIEW_ROW_LIMIT + 1 })).toThrow();
    expect(() => previewMessage({ fields: [] })).toThrow();
    expect(() => previewMessage({ containerSelector: '' })).toThrow();
  });

  it('validates both kinds of reply', () => {
    expect(
      FieldPreviewResultSchema.parse({ ok: true, rows: [{ Title: 'A', Price: 3, Sale: null }], matchCount: 3 }).ok
    ).toBe(true);
    expect(
      FieldPreviewResultSchema.parse({ ok: false, code: 'CONTAINER_NOT_FOUND', message: 'Gone.' }).ok
    ).toBe(false);
    expect(FieldPreviewResultSchema.safeParse({ ok: true, rows: [{ Title: { nested: 1 } }], matchCount: 1 }).success).toBe(
      false
    );
    expect(FieldPreviewResultSchema.safeParse({ ok: false, code: 'NOPE', message: 'x' }).success).toBe(false);
  });
});

describe('Content script preview', () => {
  let harness: ExtensionHarness;

  beforeEach(() => {
    harness = new ExtensionHarness();
  });

  afterEach(() => {
    harness.db.close();
    vi.restoreAllMocks();
  });

  it('reads the first rows with the given fields', async () => {
    renderCards(['Alpha', 'Beta', 'Gamma', 'Delta']);
    const { coordinator } = harness.loadPage(TAB, `${BASE_URL}/list`);

    const result = FieldPreviewResultSchema.parse(await coordinator.previewFields(previewMessage()));
    expect(result).toEqual({ ok: true, rows: [{ Title: 'Alpha' }, { Title: 'Beta' }, { Title: 'Gamma' }], matchCount: 4 });
  });

  it('is strictly read-only: no storage writes, no messages, no change to the page', async () => {
    renderCards(['Alpha', 'Beta']);
    const sendToBackground = vi.fn();
    const { coordinator } = harness.loadPage(TAB, `${BASE_URL}/list`, { sendToBackground });
    const before = document.body.innerHTML;
    const counts = async () => Promise.all(harness.db.tables.map((table) => table.count()));
    const storedBefore = await counts();

    await coordinator.previewFields(previewMessage());

    expect(document.body.innerHTML).toBe(before);
    expect(sendToBackground).not.toHaveBeenCalled();
    expect(await counts()).toEqual(storedBefore);
    expect(harness.broadcasts).toEqual([]);
  });

  it('keeps rows a required column would drop, so the preview shows every item', async () => {
    renderCards(['Alpha', 'Beta'], '<section><article class="card"></article></section>');
    const { coordinator } = harness.loadPage(TAB, `${BASE_URL}/list`);
    const result = FieldPreviewResultSchema.parse(
      await coordinator.previewFields(previewMessage({ fields: [{ ...title, required: true }] }))
    );
    expect(result.ok && result.rows).toHaveLength(3);
  });

  it('refuses while a job is running in the tab', async () => {
    renderCards(['Alpha']);
    const { coordinator } = harness.loadPage(TAB, `${BASE_URL}/list`);
    // A paused job holds its run open on this page, at the pause gate.
    const job = await harness.start(TAB, makeRecipe());
    await harness.coordinator.pauseJob(job.jobId);
    expect(coordinator.queryJobRun().active).toBe(true);

    const result = FieldPreviewResultSchema.parse(await coordinator.previewFields(previewMessage()));
    expect(result).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });
    expect(!result.ok && result.message).toMatch(/extraction is running in this tab/i);

    await harness.coordinator.resumeJob(job.jobId);
    await harness.settled(TAB);
  });

  it('says clearly when the list is no longer on the page', async () => {
    document.body.innerHTML = '<p>Nothing here now</p>';
    const { coordinator } = harness.loadPage(TAB, `${BASE_URL}/list`);
    const result = FieldPreviewResultSchema.parse(await coordinator.previewFields(previewMessage()));
    expect(result).toMatchObject({ ok: false, code: 'CONTAINER_NOT_FOUND' });
    expect(!result.ok && result.message).toMatch(/no longer on this page/);
  });

  it('rejects a selector that is not valid CSS', async () => {
    renderCards(['Alpha']);
    const { coordinator } = harness.loadPage(TAB, `${BASE_URL}/list`);
    const result = FieldPreviewResultSchema.parse(
      await coordinator.previewFields(previewMessage({ containerSelector: 'div[' }))
    );
    expect(result).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });
  });
});

describe('Side panel preview request', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('gives up after its timeout and says the page did not answer', async () => {
    vi.spyOn(messagingService, 'getActiveTab').mockResolvedValue({
      id: TAB,
      url: `${BASE_URL}/list`,
      title: 'List',
      isInjectable: true,
    });
    vi.spyOn(chrome.tabs, 'sendMessage').mockImplementation((() => new Promise(() => undefined)) as never);

    const started = Date.now();
    const result = await messagingService.previewFields('.card', [title], { limit: 3, timeoutMs: 50 });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(result).toMatchObject({ ok: false, code: 'TAB_DISCONNECTED' });
  });

  it('treats a reply that fails validation as an error, never as rows', async () => {
    vi.spyOn(messagingService, 'getActiveTab').mockResolvedValue({
      id: TAB,
      url: `${BASE_URL}/list`,
      title: 'List',
      isInjectable: true,
    });
    vi.spyOn(chrome.tabs, 'sendMessage').mockImplementation(((
      _tab: number,
      _message: unknown,
      callback?: (reply: unknown) => void
    ) => {
      const reply = { ok: true, rows: 'not rows' };
      callback?.(reply);
      return Promise.resolve(reply);
    }) as never);

    const result = await messagingService.previewFields('.card', [title], { limit: 3, timeoutMs: 500 });
    expect(result).toMatchObject({ ok: false, code: 'UNKNOWN_ERROR' });
  });
});

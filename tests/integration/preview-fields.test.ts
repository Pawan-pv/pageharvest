import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { buildContainerAnchor } from '@/core/detection/anchors';
import type { MultiAnchorSelector } from '@/shared/contracts/selector';
import type { FieldPreviewResult } from '@/shared/contracts/message';
import { useExtractionWorkflow } from '@/hooks/useExtractionWorkflow';
import { ProjectRepository } from '@/storage/repositories';
import { db } from '@/storage/db';
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
    expect(result).toEqual({
      ok: true,
      rows: [{ Title: 'Alpha' }, { Title: 'Beta' }, { Title: 'Gamma' }],
      matchCount: 4,
      usedFallback: false,
    });
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

describe('Preview on a page whose layout changed', () => {
  let harness: ExtensionHarness;

  beforeEach(() => {
    harness = new ExtensionHarness();
  });

  afterEach(() => {
    harness.db.close();
    vi.restoreAllMocks();
  });

  /** Builds the backup ladder on the original page, then changes the markup as a site redesign would. */
  function driftedPage(): MultiAnchorSelector {
    document.body.innerHTML = `
      <main><section class="grid">
        <article class="card"><h2 class="title">Alpha</h2></article>
        <article class="card"><h2 class="title">Beta</h2></article>
        <article class="card"><h2 class="title">Gamma</h2></article>
      </section></main>`;
    const grid = document.querySelector('.grid') as Element;
    const anchor = buildContainerAnchor(grid, grid.firstElementChild as Element, '.card');
    if (!anchor) throw new Error('no anchor');
    // The site renames its card class: the saved selector and the class backup no longer match.
    document.querySelectorAll('.card').forEach((card) => card.setAttribute('class', 'product-v2'));
    return anchor;
  }

  it('previews through the backup anchor and says it did', async () => {
    const anchor = driftedPage();
    const { coordinator } = harness.loadPage(TAB, `${BASE_URL}/list`);
    expect(document.querySelectorAll('.card')).toHaveLength(0);

    const result = FieldPreviewResultSchema.parse(
      await coordinator.previewFields(previewMessage({ containerAnchor: anchor }))
    );
    expect(result).toEqual({
      ok: true,
      rows: [{ Title: 'Alpha' }, { Title: 'Beta' }, { Title: 'Gamma' }],
      matchCount: 3,
      usedFallback: true,
    });
  });

  it('uses a matching class backup before the fingerprint', async () => {
    document.body.innerHTML = '<section><article class="tile"><h2 class="title">Alpha</h2></article><article class="tile"><h2 class="title">Beta</h2></article></section>';
    const { coordinator } = harness.loadPage(TAB, `${BASE_URL}/list`);
    const result = FieldPreviewResultSchema.parse(
      await coordinator.previewFields(previewMessage({ containerAnchor: { primary: '.card', fallbackClass: '.tile' } }))
    );
    expect(result).toMatchObject({ ok: true, usedFallback: true, matchCount: 2 });
  });

  it('reports the saved selector as used when it still matches', async () => {
    renderCards(['Alpha']);
    const { coordinator } = harness.loadPage(TAB, `${BASE_URL}/list`);
    const result = FieldPreviewResultSchema.parse(
      await coordinator.previewFields(previewMessage({ containerAnchor: { primary: '.card', fallbackClass: '.nothing' } }))
    );
    expect(result).toMatchObject({ ok: true, usedFallback: false });
  });

  it('writes nothing: no IndexedDB rows, no messages, no change to the page or to the anchor it was given', async () => {
    const anchor = driftedPage();
    const anchorBefore = JSON.parse(JSON.stringify(anchor));
    const sendToBackground = vi.fn();
    const { coordinator } = harness.loadPage(TAB, `${BASE_URL}/list`, { sendToBackground });
    const counts = async () =>
      Object.fromEntries(await Promise.all(harness.db.tables.map(async (table) => [table.name, await table.count()])));
    const storedBefore = await counts();
    const pageBefore = document.body.innerHTML;

    await coordinator.previewFields(previewMessage({ containerAnchor: anchor }));

    expect(await counts()).toEqual(storedBefore);
    expect(sendToBackground).not.toHaveBeenCalled();
    expect(harness.broadcasts).toEqual([]);
    expect(document.body.innerHTML).toBe(pageBefore);
    expect(anchor).toEqual(anchorBefore);
  });
});

describe('The panel after a backup-anchor preview', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the saved selector and anchor, and stores no recipe or schema', async () => {
    await db.clearAllData();
    vi.spyOn(ProjectRepository.prototype, 'getAllProjects').mockResolvedValue([]);
    const preview = vi.spyOn(messagingService, 'previewFields').mockResolvedValue({
      ok: true,
      rows: [{ Title: 'Alpha' }],
      matchCount: 1,
      usedFallback: true,
    });
    const anchor = { primary: '.card', fallbackClass: '.tile' };
    const tab = { id: TAB, url: `${BASE_URL}/list`, title: 'List', isInjectable: true };
    let workflow: ReturnType<typeof useExtractionWorkflow> | undefined;
    function Probe() {
      workflow = useExtractionWorkflow(tab);
      return null;
    }
    render(createElement(Probe));
    await waitFor(() => expect(workflow?.recordWarningThreshold).toBeDefined());
    await act(async () => {
      workflow?.loadSchema(makeRecipe({}, { containerAnchor: anchor }));
    });
    await waitFor(() => expect(workflow?.detectedList?.containerSelector).toBe('.card'));
    const before = { recipes: await db.recipes.count(), schemas: await db.schemas.count() };

    let result: FieldPreviewResult | undefined;
    await act(async () => {
      result = await workflow?.previewFields(workflow.fields);
    });

    expect(result).toMatchObject({ ok: true, usedFallback: true });
    expect(preview).toHaveBeenCalledWith('.card', expect.any(Array), { containerAnchor: anchor });
    expect(workflow?.detectedList?.containerSelector).toBe('.card');
    expect(workflow?.detectedList?.containerAnchor).toEqual(anchor);
    expect({ recipes: await db.recipes.count(), schemas: await db.schemas.count() }).toEqual(before);
  });
});

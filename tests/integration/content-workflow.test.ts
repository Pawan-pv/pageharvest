import { describe, expect, it } from 'vitest';
import {
  createContentWorkflowCoordinator,
  ContentWorkflowCoordinator,
} from '@/content/workflow-coordinator';
import { ExtensionMessage } from '@/contracts/messages';

function makeCoordinator(emitted: ExtensionMessage[]): ContentWorkflowCoordinator {
  return createContentWorkflowCoordinator((message) => emitted.push(message));
}

const identity = {
  jobId: 'job_1',
  projectId: 'project_1',
  datasetId: 'dataset_1',
  runId: 'run_1',
  generation: 'gen_1',
};

describe('content workflow coordinator', () => {
  it('detects a repeated list from a selected element and emits the preview', async () => {
    document.body.innerHTML = `
      <section class="products">
        <article class="product-card"><h2>Keyboard</h2><span class="price">$49</span></article>
        <article class="product-card"><h2>Mouse</h2><span class="price">$29</span></article>
        <article class="product-card"><h2>Monitor</h2><span class="price">$199</span></article>
      </section>
    `;
    const emitted: ExtensionMessage[] = [];
    const coordinator = makeCoordinator(emitted);

    const response = await coordinator.detectRepeatedElements({
      id: 'detect-1',
      timestamp: 1,
      type: 'DETECT_REPEATED_ELEMENTS',
      payload: { targetSelector: '.product-card' },
    });

    expect(response.type).toBe('REPEATED_ELEMENTS_DETECTED');
    if (response.type === 'REPEATED_ELEMENTS_DETECTED') {
      expect(response.payload.matchCount).toBe(3);
      expect(response.payload.containerSelector).toContain('product-card');
      expect(response.payload.sampleSnippets).toEqual(
        expect.arrayContaining(['Keyboard$49', 'Mouse$29'])
      );
    }
    expect(emitted).toHaveLength(1);
    expect(emitted[0].type).toBe('REPEATED_ELEMENTS_DETECTED');
  });

  it('discovers fields, none of them required, and validates them against the contract', async () => {
    document.body.innerHTML = `
      <section class="products">
        <article class="product-card"><h2>Keyboard</h2><span class="price">$49</span></article>
        <article class="product-card"><h2>Mouse</h2><span class="price">$29</span></article>
      </section>
    `;
    const emitted: ExtensionMessage[] = [];
    const coordinator = makeCoordinator(emitted);

    const fieldsResponse = await coordinator.detectFields({
      id: 'fields-1',
      timestamp: 2,
      type: 'DETECT_FIELDS',
      payload: { containerSelector: '.product-card' },
    });

    expect(fieldsResponse.type).toBe('FIELDS_DETECTED');
    if (fieldsResponse.type === 'FIELDS_DETECTED') {
      expect(fieldsResponse.payload.suggestedFields.length).toBeGreaterThan(0);
      expect(fieldsResponse.payload.suggestedFields.every((field) => !field.required)).toBe(true);
    }
    expect(emitted.map((message) => message.type)).toEqual(['FIELDS_DETECTED']);
  });

  it('reports a selector that matches nothing instead of inventing a result', async () => {
    document.body.innerHTML = '<p>Nothing repeated here</p>';
    const coordinator = makeCoordinator([]);

    await expect(
      coordinator.detectRepeatedElements({
        id: 'detect-2',
        timestamp: 1,
        type: 'DETECT_REPEATED_ELEMENTS',
        payload: { targetSelector: '.missing' },
      })
    ).rejects.toThrow(/could not be found/);

    await expect(
      coordinator.detectFields({
        id: 'fields-2',
        timestamp: 1,
        type: 'DETECT_FIELDS',
        payload: { containerSelector: '.missing' },
      })
    ).rejects.toThrow(/No elements matched/);
  });

  describe('job controls', () => {
    it('reports no active run when idle, and refuses controls', () => {
      const coordinator = makeCoordinator([]);

      expect(coordinator.queryJobRun()).toEqual({ active: false });
      expect(
        coordinator.controlJob({
          id: 'c1',
          timestamp: 1,
          type: 'CONTROL_JOB',
          payload: { identity, action: 'pause' },
        })
      ).toEqual({ accepted: false, reason: 'no_active_run' });
    });

    it('refuses a control naming a stale generation, so it cannot move a newer run', async () => {
      document.body.innerHTML = '<div class="card"><h2 class="title">Row</h2></div>';
      let release: () => void = () => undefined;
      const coordinator = createContentWorkflowCoordinator(() => undefined, document, {
        getCurrentUrl: () => 'http://localhost:3000/list',
        sendToBackground: () =>
          new Promise((resolve) => {
            release = () => resolve({ status: 'committed', sequence: 1, inserted: 1, duplicates: 0 });
          }),
      });

      coordinator.extractRecords({
        id: 'x1',
        timestamp: 1,
        type: 'EXTRACT_RECORDS',
        payload: {
          identity,
          recipe: {
            id: 'r',
            name: 'r',
            urlPattern: '*',
            containerSelector: '.card',
            fields: [{ id: 't', name: 'T', selector: '.title', extractor: 'text', required: false, transform: 'trim' }],
            pagination: {
              type: 'none',
              maxPages: 1,
              delayMs: 200,
              scrollCount: 1,
              scrollDelayMs: 300,
              startPage: 1,
              pageIncrement: 1,
              stopCondition: 'no_new_records',
            },
            version: 1,
            createdAt: 1,
            updatedAt: 1,
          },
          resume: {
            page: 1,
            nextSequence: 1,
            scrollsCompleted: 0,
            catchUpScrolls: 0,
            visitedUrls: [],
            startUrl: 'http://localhost:3000/list',
          },
        },
      });

      expect(
        coordinator.controlJob({
          id: 'c2',
          timestamp: 1,
          type: 'CONTROL_JOB',
          payload: { identity: { ...identity, generation: 'gen_old' }, action: 'abort' },
        })
      ).toEqual({ accepted: false, reason: 'stale_generation' });
      expect(coordinator.queryJobRun().active).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 5));
      release();
      await new Promise((resolve) => setTimeout(resolve, 5));
      release();
      await coordinator.runSettled();
    });
  });
});

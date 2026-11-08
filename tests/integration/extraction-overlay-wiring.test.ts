import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ContentWorkflowCoordinator,
  createContentWorkflowCoordinator,
} from '@/content/workflow-coordinator';
import {
  EXTRACTION_OVERLAY_HOST_ID,
  setVisualOverlayOptions,
} from '@/content/extraction-visual-overlay';
import { ExtensionMessage } from '@/contracts/messages';

/**
 * The extraction overlay's root is closed. This records each root as it is attached
 * so the test can inspect what it renders. Production exposes nothing.
 */
const attachedRoots = new WeakMap<Element, ShadowRoot>();
const originalAttachShadow = Element.prototype.attachShadow;

function overlayRootOf(host: Element): ShadowRoot {
  const root = attachedRoots.get(host);
  if (!root) throw new Error('The extraction overlay attached no shadow root.');
  return root;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const identity = {
  jobId: 'job_1',
  projectId: 'project_1',
  datasetId: 'dataset_1',
  runId: 'run_1',
  generation: 'gen_1',
};

function makeRecipe() {
  return {
    id: 'r',
    name: 'r',
    urlPattern: '*',
    containerSelector: '.card',
    fields: [
      {
        id: 't',
        name: 'T',
        selector: '.title',
        extractor: 'text' as const,
        required: false,
        transform: 'trim' as const,
      },
    ],
    pagination: {
      type: 'none' as const,
      maxPages: 1,
      delayMs: 200,
      scrollCount: 1,
      scrollDelayMs: 300,
      startPage: 1,
      pageIncrement: 1,
      stopCondition: 'no_new_records' as const,
    },
    version: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

const resume = {
  page: 1,
  nextSequence: 1,
  recordsExtracted: 0,
  scrollsCompleted: 0,
  catchUpScrolls: 0,
  visitedUrls: [],
  startUrl: 'http://localhost:3000/list',
};

function controlMessage(action: 'pause' | 'resume' | 'abort') {
  return {
    id: 'c1',
    timestamp: 1,
    type: 'CONTROL_JOB' as const,
    payload: { identity, action },
  };
}

function extractMessage() {
  return {
    id: 'x1',
    timestamp: 1,
    type: 'EXTRACT_RECORDS' as const,
    payload: {
      identity,
      recipe: makeRecipe(),
      resume,
    },
  };
}

describe('extraction neon overlay wiring', () => {
  let coordinators: ContentWorkflowCoordinator[] = [];

  beforeEach(() => {
    Element.prototype.attachShadow = function attachAndRecord(this: Element, init: ShadowRootInit) {
      const root = originalAttachShadow.call(this, init);
      attachedRoots.set(this, root);
      return root;
    };
    document.body.innerHTML = '<div class="card"><h2 class="title">Row</h2></div>';
    // Shortened timings so integration tests stay fast; production defaults are restored
    // in afterEach.
    setVisualOverlayOptions({ completionFadeMs: 150, pulseStaggerMs: 10, pulseLifeMs: 40 });
  });

  afterEach(async () => {
    setVisualOverlayOptions(null);
    Element.prototype.attachShadow = originalAttachShadow;
    document.getElementById(EXTRACTION_OVERLAY_HOST_ID)?.remove();
    document.body.innerHTML = '';
    coordinators = [];
  });

  it('mounts the scan overlay during a run and shows the completed row count', async () => {
    const emitted: ExtensionMessage[] = [];
    let sequence = 0;
    const coordinator = createContentWorkflowCoordinator((message) => emitted.push(message), document, {
      getCurrentUrl: () => 'http://localhost:3000/list',
      sendToBackground: async () => ({
        status: 'committed' as const,
        sequence: ++sequence,
        inserted: 1,
        duplicates: 0,
      }),
    });
    coordinators.push(coordinator);

    const accepted = coordinator.extractRecords(extractMessage());
    expect(accepted).toEqual({ accepted: true });

    // The neon overlay mounts at once, before the first batch is even delivered.
    const host = document.getElementById(EXTRACTION_OVERLAY_HOST_ID)!;
    expect(host).not.toBeNull();
    const root = overlayRootOf(host);
    const laser = root.querySelector<HTMLElement>('.px-laser-bar')!;
    expect(laser.classList.contains('px-hidden')).toBe(false);
    const hud = root.querySelector<HTMLElement>('.px-hud')!;
    expect(hud.textContent).toContain('Scanning');

    await coordinator.runSettled();

    // The committed batch feeds the live row counter, and the run completion
    // announces itself in the HUD.
    expect(hud.textContent).toContain('⚡');
    expect(hud.textContent).toContain('1 rows');
    expect(hud.textContent).toContain('✓ Harvest Complete!');

    // After the fade window the overlay removes itself entirely.
    await sleep(300);
    expect(document.getElementById(EXTRACTION_OVERLAY_HOST_ID)).toBeNull();
  });

  it('continues the HUD count from the rows earlier documents already committed', async () => {
    const coordinator = createContentWorkflowCoordinator(() => undefined, document, {
      getCurrentUrl: () => 'http://localhost:3000/list',
      sendToBackground: async () => ({ status: 'committed' as const, sequence: 4, inserted: 1, duplicates: 0 }),
    });
    coordinators.push(coordinator);

    const message = extractMessage();
    coordinator.extractRecords({
      ...message,
      payload: { ...message.payload, resume: { ...resume, nextSequence: 4, recordsExtracted: 3 } },
    });

    const hud = overlayRootOf(document.getElementById(EXTRACTION_OVERLAY_HOST_ID)!).querySelector<HTMLElement>('.px-hud')!;
    expect(hud.textContent).toContain('3 rows');

    await coordinator.runSettled();
    expect(hud.textContent).toContain('4 rows');
  });

  it('removes the overlay immediately when the run is aborted', async () => {
    let release: () => void = () => undefined;
    const coordinator = createContentWorkflowCoordinator(() => undefined, document, {
      getCurrentUrl: () => 'http://localhost:3000/list',
      sendToBackground: () =>
        new Promise((resolve) => {
          release = () =>
            resolve({ status: 'committed', sequence: 1, inserted: 1, duplicates: 0 });
        }),
    });
    coordinators.push(coordinator);

    coordinator.extractRecords(extractMessage());
    await sleep(10);
    expect(document.getElementById(EXTRACTION_OVERLAY_HOST_ID)).not.toBeNull();

    const control = coordinator.controlJob(controlMessage('abort'));
    expect(control).toEqual({ accepted: true });
    expect(document.getElementById(EXTRACTION_OVERLAY_HOST_ID)).toBeNull();

    release();
    await sleep(10);
    await coordinator.runSettled();
  });
});

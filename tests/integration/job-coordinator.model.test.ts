import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { JobCoordinator, JobTransport } from '@/background/job-coordinator';
import { BatchAck, ExtensionMessage } from '@/contracts/messages';
import { JobIdentity, JobStatus, isActiveJobStatus, isTerminalJobStatus } from '@/shared/contracts/job';
import { PageHarvestDB } from '@/storage/db';
import { DatasetRepository } from '@/storage/repositories';
import { BASE_URL, makeBatch, makeRecipe, uniqueDb } from '../utils/job-harness';

/**
 * Model-based test of the background job coordinator (the only writer of extraction data).
 *
 * fast-check generates sequences of what can happen to jobs: the panel's commands, the
 * page's batches (in order, redelivered, skipped ahead, stale, from the wrong tab), tabs
 * closing, the browser restarting, the user deleting or editing saved data, and pairs of
 * these racing each other. Each command runs against the real coordinator over real
 * IndexedDB (fake-indexeddb) and against a small reference model written from the
 * contract. After every command the stored state must match the model and satisfy the
 * invariants in `checkInvariants`.
 *
 * The seed is fixed so every failure reproduces; fast-check prints the shrunk command
 * list. PH_PROPERTY_SEED / PH_PROPERTY_RUNS explore further.
 */
const SEED = Number(process.env.PH_PROPERTY_SEED ?? 20261118);
// 60 runs did not reach every path (a mutation of the redelivery check survived); 200 do.
const RUNS = Number(process.env.PH_PROPERTY_RUNS ?? 200);

const TITLES = ['A', 'B', 'C', 'D', 'E'] as const;
/** Statuses in which the coordinator can still write to the job's dataset. */
const WRITABLE: ReadonlySet<JobStatus> = new Set<JobStatus>(['CREATED', 'RUNNING', 'PAUSED', 'RECOVERABLE']);
const EXECUTING: ReadonlySet<JobStatus> = new Set<JobStatus>(['RUNNING', 'PAUSED']);

// ---------------------------------------------------------------------------
// The browser around the coordinator
// ---------------------------------------------------------------------------

class FakeBrowser {
  nextTab = 100;
  readonly closed = new Set<number>();
  /** Tabs whose document no longer runs the job (it was reloaded or discarded). */
  readonly pageGone = new Set<number>();
  readonly extractSent: Array<{ tabId: number; identity: JobIdentity }> = [];

  readonly transport: JobTransport = {
    sendToTab: async (tabId: number, message: ExtensionMessage) => {
      if (this.closed.has(tabId)) throw new Error('No tab with id: ' + tabId);
      switch (message.type) {
        case 'EXTRACT_RECORDS':
          this.pageGone.delete(tabId);
          this.extractSent.push({ tabId, identity: message.payload.identity });
          return { accepted: true };
        case 'CONTROL_JOB':
          if (this.pageGone.has(tabId)) throw new Error('Receiving end does not exist.');
          return { accepted: true };
        case 'QUERY_JOB_RUN':
          return { active: false };
        default:
          return undefined;
      }
    },
    broadcast: async () => undefined,
    openBlankTab: async () => this.nextTab++,
    navigateTab: async (tabId: number) => {
      if (this.closed.has(tabId)) throw new Error('No tab with id: ' + tabId);
    },
    getTabLoadStatus: async (tabId: number) => (this.closed.has(tabId) ? null : 'complete'),
    injectContentScript: async (tabId: number) => {
      if (this.closed.has(tabId)) throw new Error('No tab with id: ' + tabId);
      return { injected: false, url: BASE_URL };
    },
  };
}

interface Real {
  db: PageHarvestDB;
  browser: FakeBrowser;
  coordinator: JobCoordinator;
  datasets: DatasetRepository;
  clock: { now: number };
}

// ---------------------------------------------------------------------------
// The reference model
// ---------------------------------------------------------------------------

interface ModelJob {
  id: string;
  datasetId: string;
  tabId: number;
  paginated: boolean;
  status: JobStatus;
  lastSequence: number;
  /** The identity the page is running as now. */
  identity: JobIdentity;
  /** Identities of earlier generations, which must never write again. */
  stale: JobIdentity[];
  /** Titles stored in the dataset, in display order. */
  rows: string[];
  totalExtracted: number;
  emptySteps: number;
  /** Whether the checkpoint says the job is between documents. */
  awaiting: boolean;
  datasetDeleted: boolean;
}

interface Model {
  jobs: ModelJob[];
  /** Three browser tabs the user works in; closing one opens a new one in its place. */
  slots: number[];
  pageGone: Set<number>;
}

function pick(model: Model, index: number): ModelJob {
  return model.jobs[index % model.jobs.length];
}

function activeIn(model: Model, tabId: number): ModelJob | undefined {
  return model.jobs.find((job) => job.tabId === tabId && isActiveJobStatus(job.status));
}

function retire(job: ModelJob): void {
  job.stale.push(job.identity);
}

/** The coordinator's dedupe rule, as the contract states it, applied to the model. */
function applyBatch(job: ModelJob, titles: readonly string[]): number {
  const dedupe = job.paginated || job.lastSequence > 0;
  let inserted = 0;
  for (const title of titles) {
    if (dedupe && job.rows.includes(title)) continue;
    job.rows.push(title);
    inserted++;
  }
  job.lastSequence++;
  job.totalExtracted += inserted;
  job.awaiting = false;
  if (inserted > 0) {
    job.emptySteps = 0;
  } else {
    job.emptySteps++;
    if (job.emptySteps >= 3) {
      job.status = 'COMPLETED';
      retire(job);
    }
  }
  return inserted;
}

// ---------------------------------------------------------------------------
// Messages from the page
// ---------------------------------------------------------------------------

function batch(identity: JobIdentity, sequence: number, titles: readonly string[]) {
  const message = makeBatch(identity, sequence, [...titles]);
  return (message as Extract<ExtensionMessage, { type: 'RECORD_BATCH' }>).payload;
}

async function sendBatch(real: Real, job: ModelJob, identity: JobIdentity, sequence: number, titles: readonly string[], tabId = job.tabId): Promise<BatchAck> {
  real.clock.now += 1000;
  return real.coordinator.commitBatch(batch(identity, sequence, titles), { tabId });
}

// ---------------------------------------------------------------------------
// Invariants over everything stored
// ---------------------------------------------------------------------------

async function checkInvariants(model: Model, real: Real): Promise<void> {
  const { db } = real;
  const [jobs, checkpoints, history, datasets, records] = await Promise.all([
    db.jobs.toArray(),
    db.checkpoints.toArray(),
    db.history.toArray(),
    db.datasets.toArray(),
    db.records.toArray(),
  ]);
  const checkpointIds = new Set(checkpoints.map((c) => c.jobId));
  const historyById = new Map(history.map((h) => [h.jobId, h]));
  const datasetById = new Map(datasets.map((d) => [d.id, d]));

  // A checkpoint is the resumable state of a job that can still continue, and only that.
  for (const job of jobs) {
    expect(job.status, `job ${job.id} was stored as INTERRUPTED`).not.toBe('INTERRUPTED');
    expect(checkpointIds.has(job.id), `checkpoint of ${job.status} job ${job.id}`).toBe(WRITABLE.has(job.status));
    const run = historyById.get(job.id);
    expect(Boolean(run), `history row of ${job.status} job ${job.id}`).toBe(isTerminalJobStatus(job.status));
    if (run) {
      expect(run.status).toBe(job.status);
      expect(run.totalExtracted).toBe(job.totalExtracted);
      expect(job.finishedAt).toBeDefined();
    }
  }
  for (const checkpoint of checkpoints) {
    expect(jobs.some((j) => j.id === checkpoint.jobId), `checkpoint ${checkpoint.jobId} without a job`).toBe(true);
  }

  // At most one job runs in a tab.
  const activeTabs = jobs.filter((j) => isActiveJobStatus(j.status)).map((j) => j.tabId);
  expect(new Set(activeTabs).size).toBe(activeTabs.length);

  // Every row belongs to a dataset that exists, and to that dataset's job. Counts agree.
  for (const record of records) {
    const dataset = datasetById.get(record.datasetId as string);
    expect(dataset, `row ${record._id} points to deleted dataset ${record.datasetId}`).toBeDefined();
    expect(record._jobId).toBe(dataset?.jobId);
  }
  for (const dataset of datasets) {
    const count = records.filter((r) => r.datasetId === dataset.id).length;
    expect(dataset.recordsCount, `recordsCount of ${dataset.id}`).toBe(count);
  }

  // The stored state is the state the model predicts.
  for (const expected of model.jobs) {
    const stored = jobs.find((j) => j.id === expected.id);
    expect(stored).toBeDefined();
    expect(stored?.status, `status of ${expected.id}`).toBe(expected.status);
    expect(stored?.lastSequence).toBe(expected.lastSequence);
    expect(stored?.totalExtracted).toBe(expected.totalExtracted);
    expect(stored?.tabId).toBe(expected.tabId);
    expect(datasetById.has(expected.datasetId)).toBe(!expected.datasetDeleted);
    if (!expected.datasetDeleted) {
      const titles = (await db.getDatasetRecords(expected.datasetId)).map((r) => r.Title);
      expect(titles, `rows of ${expected.id}`).toEqual(expected.rows);
    }
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

type Cmd = fc.AsyncCommand<Model, Real>;

class StartJob implements Cmd {
  constructor(readonly slot: number, readonly paginated: boolean) {}
  check = () => true;
  async run(model: Model, real: Real) {
    const tabId = model.slots[this.slot];
    const busy = activeIn(model, tabId);
    real.clock.now += 1000;
    const result = await real.coordinator.startJob({
      recipe: this.paginated ? makeRecipe({ type: 'next_button', nextButtonSelector: '.next', maxPages: 50 }) : makeRecipe(),
      tabId,
      sourceUrl: BASE_URL,
    });
    expect(result.ok, result.error).toBe(!busy);
    if (result.ok && result.identity) {
      model.pageGone.delete(tabId);
      model.jobs.push({
        id: result.identity.jobId,
        datasetId: result.identity.datasetId,
        tabId,
        paginated: this.paginated,
        status: 'RUNNING',
        lastSequence: 0,
        identity: result.identity,
        stale: [],
        rows: [],
        totalExtracted: 0,
        emptySteps: 0,
        awaiting: false,
        datasetDeleted: false,
      });
    }
    await checkInvariants(model, real);
  }
  toString = () => `StartJob(slot ${this.slot}, ${this.paginated ? 'paginated' : 'single page'})`;
}

type BatchKind = 'next' | 'redeliver' | 'skip' | 'stale' | 'wrongTab';

class SendBatch implements Cmd {
  constructor(readonly job: number, readonly kind: BatchKind, readonly titles: string[]) {}
  check = (model: Readonly<Model>) =>
    model.jobs.length > 0 &&
    (this.kind !== 'stale' || pick(model as Model, this.job).stale.length > 0) &&
    (this.kind !== 'redeliver' || pick(model as Model, this.job).lastSequence > 0);
  async run(model: Model, real: Real) {
    const job = pick(model, this.job);
    const executing = EXECUTING.has(job.status);
    let ack: BatchAck;
    switch (this.kind) {
      case 'next': {
        ack = await sendBatch(real, job, job.identity, job.lastSequence + 1, this.titles);
        if (executing) {
          expect(ack.status).toBe('committed');
          const inserted = applyBatch(job, this.titles);
          expect(ack.inserted).toBe(inserted);
          expect(ack.shouldStop === true).toBe(job.status === 'COMPLETED');
        } else {
          expect(ack.status).toBe('rejected');
        }
        break;
      }
      case 'redeliver':
        ack = await sendBatch(real, job, job.identity, job.lastSequence, this.titles);
        expect(ack.status).toBe(executing ? 'duplicate' : 'rejected');
        expect(ack.inserted).toBe(0);
        break;
      case 'skip':
        ack = await sendBatch(real, job, job.identity, job.lastSequence + 2, this.titles);
        expect(ack.status).toBe('rejected');
        break;
      case 'stale':
        ack = await sendBatch(real, job, job.stale[this.titles.length % job.stale.length], job.lastSequence + 1, this.titles);
        expect(ack.status).toBe('rejected');
        break;
      case 'wrongTab':
        ack = await sendBatch(real, job, job.identity, job.lastSequence + 1, this.titles, 9_999);
        expect(ack.status).toBe('rejected');
        break;
    }
    await checkInvariants(model, real);
  }
  toString = () => `SendBatch(job ${this.job}, ${this.kind}, [${this.titles.join(',')}])`;
}

class PageCheckpoint implements Cmd {
  constructor(readonly job: number) {}
  check = (model: Readonly<Model>) => model.jobs.length > 0;
  async run(model: Model, real: Real) {
    const job = pick(model, this.job);
    real.clock.now += 1000;
    const ack = await real.coordinator.commitCheckpoint(
      {
        identity: job.identity,
        navigation: {
          nextPage: job.lastSequence + 1,
          scrollsCompleted: 0,
          awaitingNavigation: true,
          expectedUrl: `${BASE_URL}/page-${job.lastSequence + 1}`,
          visitedUrls: [],
          url: `${BASE_URL}/page-${job.lastSequence}`,
        },
      },
      { tabId: job.tabId }
    );
    if (EXECUTING.has(job.status)) {
      expect(ack.status).toBe('committed');
      job.awaiting = true;
    } else {
      expect(ack.status).toBe('rejected');
    }
    await checkInvariants(model, real);
  }
  toString = () => `PageCheckpoint(job ${this.job})`;
}

/**
 * A new document in a tab reported in (handleContentReady). It concerns whichever job is
 * running in that tab now, which may be a newer job than the one the tab was picked by.
 */
class DocumentLoaded implements Cmd {
  constructor(readonly job: number) {}
  check = (model: Readonly<Model>) => model.jobs.length > 0;
  async run(model: Model, real: Real) {
    const tabId = pick(model, this.job).tabId;
    real.clock.now += 1000;
    await real.coordinator.handleContentReady(`${BASE_URL}/page-next`, tabId);
    const job = activeIn(model, tabId);
    if (job && EXECUTING.has(job.status)) {
      // A next-button job follows any same-site document; other jobs only an expected one.
      if (job.paginated || job.awaiting) {
        job.awaiting = job.status === 'PAUSED';
        if (job.status === 'RUNNING') model.pageGone.delete(job.tabId);
      } else {
        job.status = 'RECOVERABLE';
        retire(job);
      }
    }
    await checkInvariants(model, real);
  }
  toString = () => `DocumentLoaded(job ${this.job})`;
}

type PanelAction = 'pause' | 'resume' | 'cancel' | 'finish' | 'discard';

class PanelCommand implements Cmd {
  constructor(readonly job: number, readonly action: PanelAction) {}
  check = (model: Readonly<Model>) => model.jobs.length > 0;
  async run(model: Model, real: Real) {
    const job = pick(model, this.job);
    real.clock.now += 1000;
    const c = real.coordinator;
    const result =
      this.action === 'pause'
        ? await c.pauseJob(job.id)
        : this.action === 'resume'
          ? await c.resumeJob(job.id)
          : this.action === 'cancel'
            ? await c.cancelJob(job.id)
            : this.action === 'finish'
              ? await c.finishJob(job.id)
              : await c.discardJob(job.id);

    let next: JobStatus | undefined;
    if (this.action === 'pause' && job.status === 'RUNNING') next = 'PAUSED';
    if (this.action === 'resume' && job.status === 'PAUSED') next = 'RUNNING';
    if ((this.action === 'cancel' || this.action === 'discard') && WRITABLE.has(job.status)) next = 'CANCELLED';
    if (this.action === 'finish' && EXECUTING.has(job.status)) next = 'COMPLETED';

    expect(result.ok, `${this.action} on ${job.status}: ${result.error}`).toBe(next !== undefined);
    if (next) {
      if (this.action === 'resume' && model.pageGone.has(job.tabId)) {
        // No live run answered, so the page is restarted from the checkpoint.
        job.awaiting = false;
        model.pageGone.delete(job.tabId);
      }
      if (isTerminalJobStatus(next)) retire(job);
      job.status = next;
    }
    await checkInvariants(model, real);
  }
  toString = () => `Panel(${this.action}, job ${this.job})`;
}

class PageReportsEnd implements Cmd {
  constructor(readonly job: number, readonly outcome: 'finished' | 'finished_early' | 'failed' | 'lost') {}
  check = (model: Readonly<Model>) => model.jobs.length > 0;
  async run(model: Model, real: Real) {
    const job = pick(model, this.job);
    const executing = EXECUTING.has(job.status);
    real.clock.now += 1000;
    const sender = { tabId: job.tabId };
    if (this.outcome === 'finished' || this.outcome === 'finished_early') {
      // finished_early names a batch that was never stored, so it may not complete the job.
      const lastSequence = this.outcome === 'finished' ? job.lastSequence : job.lastSequence + 1;
      const ack = await real.coordinator.completeJob({ identity: job.identity, lastSequence, stopReason: 'completed' }, sender);
      const completes = executing && this.outcome === 'finished';
      expect(ack.status).toBe(completes ? 'committed' : 'rejected');
      if (completes) {
        job.status = 'COMPLETED';
        retire(job);
      }
    } else {
      const recoverable = this.outcome === 'lost';
      const ack = await real.coordinator.reportJobFailure(
        { identity: job.identity, message: 'page problem', category: 'DOM_PARSING', recoverable },
        sender
      );
      expect(ack.status).toBe(executing ? 'committed' : 'rejected');
      if (executing) {
        job.status = recoverable ? 'RECOVERABLE' : 'FAILED';
        retire(job);
      }
    }
    await checkInvariants(model, real);
  }
  toString = () => `PageReportsEnd(job ${this.job}, ${this.outcome})`;
}

class CloseTab implements Cmd {
  constructor(readonly slot: number) {}
  check = () => true;
  async run(model: Model, real: Real) {
    const tabId = model.slots[this.slot];
    real.browser.closed.add(tabId);
    real.clock.now += 1000;
    await real.coordinator.handleTabClosed(tabId);
    const job = activeIn(model, tabId);
    if (job) {
      job.status = 'RECOVERABLE';
      retire(job);
    }
    model.slots[this.slot] = real.browser.nextTab++;
    await checkInvariants(model, real);
  }
  toString = () => `CloseTab(slot ${this.slot})`;
}

class UnloadPage implements Cmd {
  constructor(readonly job: number) {}
  check = (model: Readonly<Model>) => model.jobs.length > 0;
  async run(model: Model, real: Real) {
    const job = pick(model, this.job);
    real.browser.pageGone.add(job.tabId);
    model.pageGone.add(job.tabId);
    await checkInvariants(model, real);
  }
  toString = () => `UnloadPage(job ${this.job})`;
}

class BrowserRestart implements Cmd {
  check = () => true;
  async run(model: Model, real: Real) {
    real.clock.now += 1000;
    real.coordinator = new JobCoordinator({
      db: real.db,
      transport: real.browser.transport,
      checkPermissions: async () => ({ allGranted: true, missing: [] }),
      reporter: { report: quietReport },
      now: () => real.clock.now,
    });
    await real.coordinator.reconcile('startup');
    for (const job of model.jobs) {
      if (isActiveJobStatus(job.status)) {
        job.status = 'RECOVERABLE';
        retire(job);
      }
    }
    await checkInvariants(model, real);
  }
  toString = () => 'BrowserRestart';
}

class Recover implements Cmd {
  constructor(readonly job: number) {}
  check = (model: Readonly<Model>) => model.jobs.length > 0;
  async run(model: Model, real: Real) {
    const job = pick(model, this.job);
    const newTab = real.browser.nextTab;
    real.clock.now += 1000;
    const result = await real.coordinator.recoverJob(job.id);
    expect(result.ok, result.error).toBe(job.status === 'RECOVERABLE');
    if (result.ok && result.identity) {
      job.status = 'RUNNING';
      job.identity = result.identity;
      job.tabId = newTab;
      job.emptySteps = 0;
      job.awaiting = true;
    }
    await checkInvariants(model, real);
  }
  toString = () => `Recover(job ${this.job})`;
}

/** The user deletes the job's list from "My data". */
class DeleteDataset implements Cmd {
  constructor(readonly job: number) {}
  check = (model: Readonly<Model>) => model.jobs.length > 0 && !pick(model as Model, this.job).datasetDeleted;
  async run(model: Model, real: Real) {
    const job = pick(model, this.job);
    // A list a job can still write to cannot be deleted from under it.
    const refused = WRITABLE.has(job.status);
    const outcome = await real.datasets.deleteDataset(job.datasetId).then(
      () => 'deleted',
      (error: unknown) => (error instanceof Error ? error.message : String(error))
    );
    if (refused) {
      expect(outcome).not.toBe('deleted');
    } else {
      expect(outcome).toBe('deleted');
      job.datasetDeleted = true;
      job.rows = [];
    }
    await checkInvariants(model, real);
  }
  toString = () => `DeleteDataset(job ${this.job})`;
}

/**
 * The user opened the job's list in the grid and removes its first row, while the page
 * may be committing another batch between the grid's read and its save.
 */
class EditWhileCollecting implements Cmd {
  constructor(readonly job: number, readonly titles: string[]) {}
  check = (model: Readonly<Model>) => model.jobs.length > 0 && !pick(model as Model, this.job).datasetDeleted;
  async run(model: Model, real: Real) {
    const job = pick(model, this.job);
    const dataset = await real.db.datasets.get(job.datasetId);
    const shown = await real.db.getDatasetRecords(job.datasetId);

    // The page commits while the grid holds its copy.
    if (EXECUTING.has(job.status)) {
      const ack = await sendBatch(real, job, job.identity, job.lastSequence + 1, this.titles);
      expect(ack.status).toBe('committed');
      applyBatch(job, this.titles);
    }

    const writable = WRITABLE.has(job.status) && job.status !== 'RECOVERABLE';
    const outcome = await real.datasets
      .applyEdit(job.datasetId, shown.slice(1), dataset?.fields ?? [])
      .then(
        () => 'saved',
        () => 'refused'
      );
    if (writable) {
      // Saving the grid's copy would delete what the job committed meanwhile.
      expect(outcome).toBe('refused');
    } else {
      expect(outcome).toBe('saved');
      job.rows = shown.slice(1).map((row) => row.Title as string);
    }
    await checkInvariants(model, real);
  }
  toString = () => `EditWhileCollecting(job ${this.job}, [${this.titles.join(',')}])`;
}

// ---------------------------------------------------------------------------
// Races: two things happen at once. Either order is allowed; the invariants must hold.
// ---------------------------------------------------------------------------

async function resyncAll(model: Model, real: Real): Promise<void> {
  for (const job of model.jobs) await resync(model, real, job);
}

async function resync(model: Model, real: Real, job: ModelJob): Promise<void> {
  const stored = await real.db.jobs.get(job.id);
  if (!stored) throw new Error(`job ${job.id} vanished`);
  if (stored.status !== job.status && !EXECUTING.has(stored.status)) retire(job);
  job.status = stored.status;
  job.lastSequence = stored.lastSequence;
  job.totalExtracted = stored.totalExtracted;
  job.emptySteps = stored.consecutiveEmptySteps;
  job.tabId = stored.tabId ?? job.tabId;
  const checkpoint = await real.db.checkpoints.get(job.id);
  job.awaiting = checkpoint?.awaitingNavigation ?? false;
  if (!job.datasetDeleted) {
    job.rows = (await real.db.getDatasetRecords(job.datasetId)).map((row) => row.Title as string);
  }
  void model;
}

class RaceCancelWithBatch implements Cmd {
  constructor(readonly job: number, readonly titles: string[], readonly finish: boolean) {}
  check = (model: Readonly<Model>) => model.jobs.length > 0;
  async run(model: Model, real: Real) {
    const job = pick(model, this.job);
    const before = job.totalExtracted;
    const [ack, result] = await Promise.all([
      sendBatch(real, job, job.identity, job.lastSequence + 1, this.titles),
      this.finish ? real.coordinator.finishJob(job.id) : real.coordinator.cancelJob(job.id),
    ]);
    await resync(model, real, job);
    // Rows are durable exactly when the page was told they were.
    expect(job.totalExtracted - before).toBe(ack.status === 'committed' ? ack.inserted : 0);
    if (result.ok) expect(isTerminalJobStatus(job.status)).toBe(true);
    await checkInvariants(model, real);
  }
  toString = () => `Race(${this.finish ? 'finish' : 'cancel'} || batch, job ${this.job})`;
}

class RaceDocumentWithEnd implements Cmd {
  constructor(readonly job: number, readonly end: 'cancel' | 'finish' | 'pause' | 'closeTab') {}
  check = (model: Readonly<Model>) => model.jobs.length > 0;
  async run(model: Model, real: Real) {
    const job = pick(model, this.job);
    const c = real.coordinator;
    const tabId = job.tabId;
    const ending =
      this.end === 'cancel'
        ? c.cancelJob(job.id)
        : this.end === 'finish'
          ? c.finishJob(job.id)
          : this.end === 'pause'
            ? c.pauseJob(job.id)
            : (real.browser.closed.add(tabId), c.handleTabClosed(tabId));
    await Promise.all([c.handleContentReady(`${BASE_URL}/page-${job.lastSequence + 1}`, tabId), ending]);
    if (this.end === 'closeTab') {
      const slot = model.slots.indexOf(tabId);
      if (slot >= 0) model.slots[slot] = real.browser.nextTab++;
    }
    await resyncAll(model, real);
    // A job that has ended was never handed to the page again under a live identity.
    if (isTerminalJobStatus(job.status) || job.status === 'RECOVERABLE') {
      const stored = await real.db.jobs.get(job.id);
      const live = real.browser.extractSent.filter((sent) => sent.identity.generation === stored?.generation);
      expect(live).toEqual([]);
    }
    await checkInvariants(model, real);
  }
  toString = () => `Race(document loaded || ${this.end}, job ${this.job})`;
}

class RaceTwoStarts implements Cmd {
  constructor(readonly slot: number) {}
  check = () => true;
  async run(model: Model, real: Real) {
    const tabId = model.slots[this.slot];
    const busy = activeIn(model, tabId);
    const request = { recipe: makeRecipe({ type: 'next_button', nextButtonSelector: '.next', maxPages: 50 }), tabId, sourceUrl: BASE_URL };
    const results = await Promise.all([real.coordinator.startJob(request), real.coordinator.startJob(request)]);
    const started = results.filter((r) => r.ok);
    // A double click starts one job, never two.
    expect(started.length).toBe(busy ? 0 : 1);
    for (const result of started) {
      model.pageGone.delete(tabId);
      model.jobs.push({
        id: result.identity!.jobId,
        datasetId: result.identity!.datasetId,
        tabId,
        paginated: true,
        status: 'RUNNING',
        lastSequence: 0,
        identity: result.identity!,
        stale: [],
        rows: [],
        totalExtracted: 0,
        emptySteps: 0,
        awaiting: false,
        datasetDeleted: false,
      });
    }
    await checkInvariants(model, real);
  }
  toString = () => `Race(start || start, slot ${this.slot})`;
}

class RaceTwoRecovers implements Cmd {
  constructor(readonly job: number) {}
  check = (model: Readonly<Model>) => model.jobs.length > 0;
  async run(model: Model, real: Real) {
    const job = pick(model, this.job);
    const wasRecoverable = job.status === 'RECOVERABLE';
    const tabsBefore = real.browser.nextTab;
    const results = await Promise.all([real.coordinator.recoverJob(job.id), real.coordinator.recoverJob(job.id)]);
    const resumed = results.filter((r) => r.ok);
    // Two clicks on Continue resume the session once, in one new tab, and leave no empty tab.
    expect(resumed.length).toBe(wasRecoverable ? 1 : 0);
    expect(real.browser.nextTab - tabsBefore).toBe(wasRecoverable ? 1 : 0);
    if (resumed[0]?.identity) job.identity = resumed[0].identity;
    await resync(model, real, job);
    await checkInvariants(model, real);
  }
  toString = () => `Race(recover || recover, job ${this.job})`;
}

// ---------------------------------------------------------------------------

function quietReport(category: string, error: unknown) {
  return {
    id: `err_${Math.random().toString(36).slice(2, 10)}`,
    category,
    severity: 'ERROR' as const,
    code: 'UNKNOWN_ERROR' as const,
    message: error instanceof Error ? error.message : String(error),
    timestamp: 0,
  } as ReturnType<NonNullable<ConstructorParameters<typeof JobCoordinator>[0]['reporter']>['report']>;
}

const job = fc.nat(7);
const slot = fc.integer({ min: 0, max: 2 });
const titles = fc.array(fc.constantFrom(...TITLES), { maxLength: 3 });

const commands = fc.commands(
  [
    fc.tuple(slot, fc.boolean()).map(([s, p]) => new StartJob(s, p)),
    fc.tuple(job, fc.constantFrom<BatchKind>('next', 'next', 'next', 'redeliver', 'skip', 'stale', 'wrongTab'), titles).map(
      ([j, k, t]) => new SendBatch(j, k, t)
    ),
    job.map((j) => new PageCheckpoint(j)),
    job.map((j) => new DocumentLoaded(j)),
    fc.tuple(job, fc.constantFrom<PanelAction>('pause', 'resume', 'cancel', 'finish', 'discard')).map(
      ([j, a]) => new PanelCommand(j, a)
    ),
    fc.tuple(job, fc.constantFrom('finished' as const, 'finished_early' as const, 'failed' as const, 'lost' as const)).map(
      ([j, o]) => new PageReportsEnd(j, o)
    ),
    slot.map((s) => new CloseTab(s)),
    job.map((j) => new UnloadPage(j)),
    fc.constant(new BrowserRestart()),
    job.map((j) => new Recover(j)),
    job.map((j) => new DeleteDataset(j)),
    fc.tuple(job, fc.array(fc.constantFrom('X', 'Y', 'Z'), { minLength: 1, maxLength: 2 })).map(
      ([j, t]) => new EditWhileCollecting(j, t)
    ),
    fc.tuple(job, titles, fc.boolean()).map(([j, t, f]) => new RaceCancelWithBatch(j, t, f)),
    fc.tuple(job, fc.constantFrom('cancel' as const, 'finish' as const, 'pause' as const, 'closeTab' as const)).map(
      ([j, e]) => new RaceDocumentWithEnd(j, e)
    ),
    slot.map((s) => new RaceTwoStarts(s)),
    job.map((j) => new RaceTwoRecovers(j)),
  ],
  // 'max' lets fast-check use the whole maxCommands range instead of its short default.
  { maxCommands: 40, size: 'max' }
);

const opened: PageHarvestDB[] = [];

afterEach(async () => {
  while (opened.length) {
    const db = opened.pop()!;
    db.close();
    await db.delete();
  }
});

describe('JobCoordinator against a reference model (random command sequences)', () => {
  it('keeps storage consistent with the model and the invariants after every command', async () => {
    await fc.assert(
      fc.asyncProperty(commands, async (cmds) => {
        const db = uniqueDb();
        opened.push(db);
        const browser = new FakeBrowser();
        const clock = { now: 1_800_000_000_000 };
        const real: Real = {
          db,
          browser,
          clock,
          datasets: new DatasetRepository(db),
          coordinator: new JobCoordinator({
            db,
            transport: browser.transport,
            checkPermissions: async () => ({ allGranted: true, missing: [] }),
            reporter: { report: quietReport },
            now: () => clock.now,
          }),
        };
        const model: Model = { jobs: [], slots: [1, 2, 3], pageGone: new Set() };
        await fc.asyncModelRun(() => ({ model, real }), cmds);
      }),
      { seed: SEED, numRuns: RUNS, endOnFailure: false }
    );
  }, 600_000);
});

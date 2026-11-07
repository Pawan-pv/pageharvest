import {
  ExtensionMessage,
  extensionMessageSchema,
  BatchAck,
  BatchRejectionReason,
  JobCommandResult,
  JobNavigationState,
  JobRunStatus,
  JobRunStatusSchema,
} from '@/contracts/messages';
import { ErrorReporter, errorReporter } from '@/core/resilience/error-reporter';
import {
  ExtractionStateMachine,
  canTransition,
} from '@/core/state/extraction-machine';
import {
  HashFunction,
  RECORD_IDENTITY_VERSION,
  canonicalizeRecord,
  sha256Hex,
} from '@/core/extraction/record-identity';
import {
  buildTemplateUrl,
  isSameOrigin,
  normalizeUrlForDeduplication,
  validateUrlTemplate,
} from '@/core/navigation/url-paginator';
import { checkRequiredPermissions } from '@/platform/permissions';
import { isHarvestableUrl } from '@/platform/tab-manager';
import {
  ExtractionJob,
  JobCheckpoint,
  JobIdentity,
  JobProgressKind,
  JobStatus,
  isActiveJobStatus,
} from '@/shared/contracts/job';
import { ExtractionSchema } from '@/shared/contracts/schema';
import { PageHarvestDB, RECORD_ORDER_STRIDE } from '@/storage/db';
import {
  DatasetRepository,
  HistoryRepository,
  JobRepository,
  ProjectRepository,
  SchemaRepository,
  SettingsRepository,
} from '@/storage/repositories';
import { ErrorCategory, ExtractionRunHistory, HarvestError, RecordEntity } from '@/types';
import type { ExtractionErrorCode } from '@/shared/contracts/error';

/**
 * Background job coordinator: the only owner of durable extraction state.
 *
 *   Website -> Content script -> JobCoordinator -> IndexedDB -> Side panel reads it
 *
 * Nothing important lives in memory here. A service worker can be stopped between any
 * two events, so each handler reads what it needs from IndexedDB, and each decision is
 * made and written inside one transaction. Transactions on these tables run one at a
 * time, which is what makes cancellation and batch acceptance safe against each other:
 * a batch either committed before the cancel, or it sees the cancelled job and is
 * rejected. An acknowledgement is only ever returned after its transaction resolves.
 */

export interface JobTransport {
  sendToTab(tabId: number, message: ExtensionMessage): Promise<unknown>;
  broadcast(message: ExtensionMessage): Promise<void>;
  /** Opens an empty tab, so its ID is known before any page in it can report in. */
  openBlankTab(): Promise<number>;
  navigateTab(tabId: number, url: string): Promise<void>;
  /** 'complete', 'loading', or null when the tab no longer exists. */
  getTabLoadStatus(tabId: number): Promise<string | null>;
}

export interface JobCoordinatorDeps {
  db: PageHarvestDB;
  transport: JobTransport;
  hash?: HashFunction;
  now?: () => number;
  checkPermissions?: () => Promise<{ allGranted: boolean; missing: string[] }>;
  reporter?: Pick<ErrorReporter, 'report'>;
  schedule?: (callback: () => void, delayMs: number) => void;
  /** How long a loaded tab may stay silent before the expected page counts as failed. */
  pageLoadGraceMs?: number;
}

export interface MessageSenderInfo {
  tabId?: number;
}

export type StartJobPayload = Extract<ExtensionMessage, { type: 'START_JOB' }>['payload'];
type RecordBatchPayload = Extract<ExtensionMessage, { type: 'RECORD_BATCH' }>['payload'];
type JobCheckpointPayload = Extract<ExtensionMessage, { type: 'JOB_CHECKPOINT' }>['payload'];
type JobFinishedPayload = Extract<ExtensionMessage, { type: 'JOB_FINISHED' }>['payload'];
type JobFailedPayload = Extract<ExtensionMessage, { type: 'JOB_FAILED' }>['payload'];

export type ReconcileMode = 'startup' | 'installed' | 'panel' | 'wake';

const MAX_STORED_ERRORS = 20;
/** A job updated this recently is not probed: its page may simply not have started yet. */
const RECONCILE_QUIET_MS = 5_000;
/** How long a document navigation may take before a silent tab counts as interrupted. */
const NAVIGATION_STALE_MS = 30_000;
const DAY_MS = 24 * 60 * 60 * 1000;

function messageId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function generateToken(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

function progressKindFor(schema: ExtractionSchema): JobProgressKind {
  switch (schema.pagination.type) {
    case 'infinite_scroll':
      return 'scrolls';
    case 'next_button':
    case 'url_template':
      return 'pages';
    default:
      return 'single';
  }
}

function targetStepsFor(schema: ExtractionSchema): number {
  switch (schema.pagination.type) {
    case 'infinite_scroll':
      return schema.pagination.scrollCount;
    case 'next_button':
    case 'url_template':
      return schema.pagination.maxPages;
    default:
      return 1;
  }
}

export function currentStepOf(job: ExtractionJob): number {
  return job.progressKind === 'scrolls' ? job.scrollsCompleted : job.pagesVisited;
}

export class JobCoordinator {
  private readonly db: PageHarvestDB;
  private readonly transport: JobTransport;
  private readonly hash: HashFunction;
  private readonly now: () => number;
  private readonly checkPermissions: () => Promise<{ allGranted: boolean; missing: string[] }>;
  private readonly reporter: Pick<ErrorReporter, 'report'>;
  private readonly schedule: (callback: () => void, delayMs: number) => void;
  private readonly pageLoadGraceMs: number;

  private readonly jobs: JobRepository;
  private readonly projects: ProjectRepository;
  private readonly schemas: SchemaRepository;
  private readonly datasets: DatasetRepository;
  private readonly history: HistoryRepository;
  private readonly settings: SettingsRepository;

  constructor(deps: JobCoordinatorDeps) {
    this.db = deps.db;
    this.transport = deps.transport;
    this.hash = deps.hash ?? sha256Hex;
    this.now = deps.now ?? (() => Date.now());
    this.checkPermissions = deps.checkPermissions ?? checkRequiredPermissions;
    this.reporter = deps.reporter ?? errorReporter;
    this.schedule = deps.schedule ?? ((callback, delayMs) => void setTimeout(callback, delayMs));
    this.pageLoadGraceMs = deps.pageLoadGraceMs ?? 4_000;

    this.jobs = new JobRepository(this.db);
    this.projects = new ProjectRepository(this.db);
    this.schemas = new SchemaRepository(this.db);
    this.datasets = new DatasetRepository(this.db);
    this.history = new HistoryRepository(this.db);
    this.settings = new SettingsRepository(this.db);
  }

  // -------------------------------------------------------------------------
  // Commands from the side panel
  // -------------------------------------------------------------------------

  /**
   * Tabs whose page is being told to run a job. Until the page has been told, its answer
   * that nothing is running says nothing about whether the job is alive.
   */
  private readonly handoffs = new Map<number, number>();

  private async duringHandoff<T>(tabId: number | undefined, work: () => Promise<T>): Promise<T> {
    if (tabId === undefined) return work();
    this.handoffs.set(tabId, (this.handoffs.get(tabId) ?? 0) + 1);
    try {
      return await work();
    } finally {
      const remaining = (this.handoffs.get(tabId) ?? 1) - 1;
      if (remaining > 0) {
        this.handoffs.set(tabId, remaining);
      } else {
        this.handoffs.delete(tabId);
      }
    }
  }

  private isHandingOff(job: ExtractionJob): boolean {
    return job.tabId !== undefined && this.handoffs.has(job.tabId);
  }

  public startJob(payload: StartJobPayload): Promise<JobCommandResult> {
    return this.duringHandoff(payload.tabId, () => this.startJobInTab(payload));
  }

  private async startJobInTab(payload: StartJobPayload): Promise<JobCommandResult> {
    try {
      const permissions = await this.checkPermissions();
      if (!permissions.allGranted) {
        return { ok: false, error: `Missing required permissions: ${permissions.missing.join(', ')}.` };
      }
      if (!isHarvestableUrl(payload.sourceUrl)) {
        return { ok: false, error: 'Extraction is only available on regular web pages.' };
      }

      const { recipe, tabId, sourceUrl } = payload;
      let firstUrl = sourceUrl;
      if (recipe.pagination.type === 'url_template') {
        const sequence = {
          template: recipe.pagination.urlTemplate ?? '',
          startPage: recipe.pagination.startPage,
          pageIncrement: recipe.pagination.pageIncrement,
        };
        const validation = validateUrlTemplate(sequence, sourceUrl);
        if (!validation.valid) {
          return { ok: false, error: validation.error ?? 'The URL template is not valid.' };
        }
        firstUrl = buildTemplateUrl(sequence, 1);
      }

      const schemaId = await this.stableSchemaId(recipe);
      const now = this.now();
      const settings = await this.settings.getSettings();
      const needsNavigation =
        normalizeUrlForDeduplication(firstUrl) !== normalizeUrlForDeduplication(sourceUrl);

      const created = await this.db.transaction(
        'rw',
        [this.db.jobs, this.db.checkpoints, this.db.projects, this.db.schemas, this.db.datasets],
        async () => {
          if (await this.jobs.findActiveJobForTab(tabId)) {
            throw new JobConflictError('An extraction is already running in this tab.');
          }

          const project = payload.projectId
            ? await this.projects.getProject(payload.projectId)
            : await this.projects.findOrCreateByName(new URL(sourceUrl).hostname, sourceUrl, now);
          if (!project) {
            throw new JobConflictError('The selected project no longer exists.');
          }

          const schema: ExtractionSchema = {
            ...recipe,
            id: schemaId,
            projectId: project.id,
            updatedAt: now,
          };
          const existingSchema = await this.schemas.getSchema(schemaId);
          await this.schemas.createSchema(
            existingSchema ? { ...existingSchema, projectId: project.id, updatedAt: now } : schema
          );

          const jobId = generateToken('job');
          const datasetId = generateToken('dataset');
          const runId = generateToken('run');
          const generation = generateToken('gen');

          await this.datasets.createDataset({
            id: datasetId,
            name: recipe.name,
            url: sourceUrl,
            projectId: project.id,
            jobId,
            recipeId: payload.recipeId,
            recordsCount: 0,
            fields: recipe.fields,
            createdAt: now,
            updatedAt: now,
          });

          const machine = new ExtractionStateMachine({ state: 'CREATED' });
          machine.transition({ type: 'START_EXTRACTION', totalTargetPages: targetStepsFor(schema) });

          const job: ExtractionJob = {
            id: jobId,
            projectId: project.id,
            datasetId,
            runId,
            generation,
            recipeId: payload.recipeId,
            schemaId,
            tabId,
            targetUrl: firstUrl,
            schema,
            status: machine.getState(),
            progressKind: progressKindFor(schema),
            targetSteps: targetStepsFor(schema),
            lastSequence: 0,
            totalExtracted: 0,
            duplicatesSkipped: 0,
            pagesVisited: 0,
            scrollsCompleted: 0,
            recordsDetected: 0,
            recordsWithMissingFields: 0,
            recordsFiltered: 0,
            recordsFailed: 0,
            consecutiveEmptySteps: 0,
            dedupeAlgorithm: RECORD_IDENTITY_VERSION,
            startedAt: now,
            pausedMs: 0,
            updatedAt: now,
            errors: [],
          };
          await this.jobs.createJob(job);

          const checkpoint: JobCheckpoint = {
            jobId,
            tabId,
            startUrl: firstUrl,
            currentUrl: sourceUrl,
            expectedUrl: needsNavigation ? firstUrl : undefined,
            awaitingNavigation: needsNavigation,
            navigationStartedAt: needsNavigation ? now : undefined,
            nextPage: 1,
            scrollsCompleted: 0,
            catchUpScrolls: 0,
            visitedUrls: [],
            createdAt: now,
            updatedAt: now,
            expiresAt: now + settings.retentionDays * DAY_MS,
          };
          await this.jobs.saveCheckpoint(checkpoint);

          return { job, checkpoint };
        }
      );

      const identity = this.identityOf(created.job);
      await this.notify(created.job);

      try {
        if (needsNavigation) {
          await this.transport.navigateTab(tabId, firstUrl);
        } else {
          await this.sendExtract(created.job, created.checkpoint);
        }
      } catch (error: unknown) {
        const reason = `The page could not start extraction: ${toMessage(error)}`;
        await this.failJob(created.job.id, reason, 'RUNTIME_MESSAGING');
        return { ok: false, error: reason };
      }

      return { ok: true, identity };
    } catch (error: unknown) {
      if (!(error instanceof JobConflictError)) {
        this.report('STORAGE_FAILED', error, { command: 'START_JOB' });
      }
      return { ok: false, error: toMessage(error) };
    }
  }

  public async pauseJob(jobId: string): Promise<JobCommandResult> {
    const result = await this.applyTransition(jobId, 'PAUSE', (job) => {
      job.pausedAt = this.now();
    });
    if (result.ok && result.job) {
      await this.sendControl(result.job, 'pause');
      await this.notify(result.job);
    }
    return toCommandResult(result);
  }

  public async resumeJob(jobId: string): Promise<JobCommandResult> {
    const result = await this.applyTransition(jobId, 'RESUME', (job) => {
      if (job.pausedAt) {
        job.pausedMs += Math.max(0, this.now() - job.pausedAt);
      }
      job.pausedAt = undefined;
    });
    if (!result.ok || !result.job) return toCommandResult(result);

    const job = result.job;
    const resumedInPage = await this.sendControl(job, 'resume');
    if (!resumedInPage) {
      // No live run in the tab. The page may have changed while paused, so start the
      // current document from the checkpoint.
      const checkpoint = await this.jobs.getCheckpoint(job.id);
      if (checkpoint) {
        try {
          await this.duringHandoff(job.tabId, async () => {
            await this.db.jobs.update(job.id, { updatedAt: this.now() });
            await this.db.checkpoints.update(job.id, { awaitingNavigation: false });
            await this.sendExtract(job, { ...checkpoint, awaitingNavigation: false });
          });
        } catch (error: unknown) {
          await this.interruptJob(job.id, `The page could not continue: ${toMessage(error)}`);
          return { ok: false, error: 'The page could not continue, so the job was saved for recovery.' };
        }
      }
    }
    await this.notify(job);
    return { ok: true, identity: this.identityOf(job) };
  }

  /**
   * Ends a job and keeps what it collected. The generation is replaced in the same
   * transaction, so nothing still in flight from the page can commit afterwards.
   */
  public async cancelJob(jobId: string): Promise<JobCommandResult> {
    return this.endJobByUser(jobId, 'CANCEL', 'CANCELLED', 'cancelled_by_user');
  }

  /** "Finish & View Results": stops early, and the run counts as completed. */
  public async finishJob(jobId: string): Promise<JobCommandResult> {
    return this.endJobByUser(jobId, 'FINISH', 'COMPLETED', 'finished_by_user');
  }

  public async discardJob(jobId: string): Promise<JobCommandResult> {
    return this.endJobByUser(jobId, 'CANCEL', 'CANCELLED', 'discarded_by_user');
  }

  /**
   * Resumes a recoverable job in a new tab. The job keeps its identity, its sequence
   * numbers and its committed records; only the generation changes, so a stale page
   * from before the interruption cannot write. Duplicates are prevented when the
   * re-extracted page is committed.
   */
  public async recoverJob(jobId: string): Promise<JobCommandResult> {
    const candidate = await this.jobs.getJob(jobId);
    if (!candidate || candidate.status !== 'RECOVERABLE') {
      return { ok: false, error: 'This session can no longer be resumed.' };
    }
    const existing = await this.jobs.getCheckpoint(jobId);
    if (!existing) {
      await this.failJob(jobId, 'The saved session is incomplete and cannot be resumed.', 'VALIDATION_FAILED');
      return { ok: false, error: 'The saved session is incomplete and cannot be resumed.' };
    }
    if (existing.expiresAt <= this.now()) {
      await this.expireJob(jobId);
      return { ok: false, error: 'This session has expired.' };
    }

    const resumeUrl = this.resumeUrlFor(candidate, existing);
    if (!isHarvestableUrl(resumeUrl) || !isSameOrigin(resumeUrl, existing.startUrl)) {
      await this.failJob(jobId, `The saved session points to an invalid page: ${resumeUrl}`, 'VALIDATION_FAILED');
      return { ok: false, error: 'The saved session points to an invalid page.' };
    }

    let tabId: number;
    try {
      tabId = await this.transport.openBlankTab();
    } catch (error: unknown) {
      return { ok: false, error: `Could not open a tab to resume in: ${toMessage(error)}` };
    }

    const job = await this.db.transaction('rw', this.db.jobs, this.db.checkpoints, async () => {
      const latest = await this.jobs.getJob(jobId);
      // Re-checked here so that two resume requests cannot both succeed.
      if (!latest || latest.status !== 'RECOVERABLE') return null;
      const checkpoint = await this.jobs.getCheckpoint(jobId);
      if (!checkpoint) return null;

      const machine = ExtractionStateMachine.fromJob(latest);
      machine.transition({ type: 'RECOVER' });

      const now = this.now();
      const updated: ExtractionJob = {
        ...latest,
        status: machine.getState(),
        generation: generateToken('gen'),
        tabId,
        consecutiveEmptySteps: 0,
        interruptedReason: undefined,
        interruptedAt: undefined,
        pausedAt: undefined,
        updatedAt: now,
      };
      await this.jobs.saveJob(updated);
      await this.jobs.saveCheckpoint({
        ...checkpoint,
        tabId,
        expectedUrl: resumeUrl,
        awaitingNavigation: true,
        navigationStartedAt: now,
        // Reloading a scroll feed returns to the top, so earlier scrolls are repeated.
        catchUpScrolls: checkpoint.scrollsCompleted,
        scrollsCompleted: 0,
        updatedAt: now,
      });
      return updated;
    });

    if (!job) {
      return { ok: false, error: 'This session has already been resumed or discarded.' };
    }

    await this.notify(job);
    try {
      await this.transport.navigateTab(tabId, resumeUrl);
    } catch (error: unknown) {
      await this.interruptJob(jobId, `The page could not be reopened: ${toMessage(error)}`);
      return { ok: false, error: 'The page could not be reopened.' };
    }
    return { ok: true, identity: this.identityOf(job) };
  }

  // -------------------------------------------------------------------------
  // Messages from content scripts
  // -------------------------------------------------------------------------

  /**
   * Stores one batch. Fingerprints are computed first, because awaiting Web Crypto
   * inside an IndexedDB transaction would end the transaction.
   */
  public async commitBatch(payload: RecordBatchPayload, sender: MessageSenderInfo): Promise<BatchAck> {
    const { identity, sequence } = payload;

    let prepared: PreparedRecord[];
    try {
      prepared = await Promise.all(
        payload.records.map(async (record, index) => {
          const canonical = canonicalizeRecord(record);
          const supersedes = record._supersedes;
          return {
            record,
            index,
            canonical,
            hash: await this.hash(canonical),
            supersedes,
            supersededHash: supersedes ? await this.hash(supersedes) : undefined,
          };
        })
      );
    } catch (error: unknown) {
      this.report('VALIDATION_FAILED', error, { jobId: identity.jobId, sequence });
      return rejectedAck(sequence, 'persist_failed');
    }

    let result: CommitOutcome;
    try {
      result = await this.db.transaction(
        'rw',
        [this.db.jobs, this.db.checkpoints, this.db.records, this.db.datasets, this.db.history],
        () => this.commitBatchInTransaction(payload, prepared, sender)
      );
    } catch (error: unknown) {
      this.report('STORAGE_FAILED', error, { jobId: identity.jobId, sequence });
      return rejectedAck(sequence, 'persist_failed');
    }

    if (result.job) {
      // Informational only, so the page's acknowledgement does not wait on an open panel.
      void this.notify(result.job);
    }
    return result.ack;
  }

  private async commitBatchInTransaction(
    payload: RecordBatchPayload,
    prepared: PreparedRecord[],
    sender: MessageSenderInfo
  ): Promise<CommitOutcome> {
    const { identity, sequence, page, stats, navigation } = payload;
    const job = await this.jobs.getJob(identity.jobId);

    const rejection = this.validateSender(job, identity, sender);
    if (rejection || !job) {
      return { ack: rejectedAck(sequence, rejection ?? 'unknown_job') };
    }

    // Redelivery of a batch that already committed. Its rows are in storage, so it is
    // acknowledged as durable without writing anything.
    if (sequence <= job.lastSequence) {
      return {
        ack: { status: 'duplicate', sequence, inserted: 0, duplicates: 0 },
      };
    }
    if (sequence !== job.lastSequence + 1) {
      return { ack: rejectedAck(sequence, 'out_of_order') };
    }

    const now = this.now();
    // On a single page every element is its own row, unless the page is being extracted
    // again after recovery, when rows already stored must not be added twice.
    const shouldDedupe = job.schema.pagination.type !== 'none' || job.lastSequence > 0;
    const datasetId = identity.datasetId;

    // The hash only finds candidates. A row is a duplicate only if its canonical form
    // matches, so two different records sharing a hash are both kept.
    const knownByHash = new Map<string, string[]>();
    if (shouldDedupe && prepared.length > 0) {
      const keys = Array.from(new Set(prepared.map((item) => item.hash))).map((hash) => [datasetId, hash]);
      const existing = await this.db.records.where('[datasetId+_hash]').anyOf(keys).toArray();
      for (const row of existing) {
        const hash = row._hash as string;
        const known = knownByHash.get(hash) ?? [];
        known.push(canonicalizeRecord(row));
        knownByHash.set(hash, known);
      }
    }

    const rows: RecordEntity[] = [];
    const filledIn: RecordEntity[] = [];
    let missingResolved = 0;
    let duplicates = 0;
    for (const item of prepared) {
      // Remove the marker: it describes this batch and is never part of a stored row.
      const { _supersedes: _marker, ...recordData } = item.record;

      if (item.supersededHash) {
        const stored = (
          await this.db.records.where('[datasetId+_hash]').equals([datasetId, item.supersededHash]).toArray()
        ).find((row) => canonicalizeRecord(row) === item.supersedes);
        if (stored) {
          filledIn.push({
            ...recordData,
            _id: stored._id,
            _order: stored._order,
            _page: stored._page,
            _hash: item.hash,
            _jobId: identity.jobId,
            _projectId: identity.projectId,
            _runId: identity.runId,
            _sourceUrl: stored._sourceUrl,
            datasetId,
          });
          if (stored._missingFields) missingResolved++;
          const known = knownByHash.get(item.hash) ?? [];
          known.push(item.canonical);
          knownByHash.set(item.hash, known);
          continue;
        }
      }

      if (shouldDedupe) {
        const known = knownByHash.get(item.hash) ?? [];
        if (known.includes(item.canonical)) {
          duplicates++;
          continue;
        }
        known.push(item.canonical);
        knownByHash.set(item.hash, known);
      }
      rows.push({
        ...recordData,
        _id: `${identity.jobId}:${sequence}:${item.index}`,
        _order: sequence * RECORD_ORDER_STRIDE + item.index,
        _page: page,
        _hash: item.hash,
        _jobId: identity.jobId,
        _projectId: identity.projectId,
        _runId: identity.runId,
        _sourceUrl: navigation.url,
        datasetId,
      });
    }
    if (rows.length > 0) {
      await this.db.saveExtractedBatch(datasetId, rows);
    }
    if (filledIn.length > 0) {
      await this.db.records.bulkPut(filledIn);
    }

    const machine = ExtractionStateMachine.fromJob(job);
    machine.transition({
      type: 'RECORDS_EXTRACTED',
      count: rows.length,
      duplicates: duplicates + stats.duplicates,
      // A step that only filled in values still made progress.
      ignoreEmpty: navigation.isCatchUp === true || filledIn.length > 0,
    });
    const context = machine.getContext();

    const updated: ExtractionJob = {
      ...job,
      status: context.state,
      lastSequence: sequence,
      totalExtracted: context.totalExtracted,
      duplicatesSkipped: context.totalDuplicates,
      consecutiveEmptySteps: context.consecutiveEmptySteps,
      pagesVisited: Math.max(job.pagesVisited, page),
      scrollsCompleted: Math.max(job.scrollsCompleted, navigation.scrollsCompleted),
      recordsDetected: job.recordsDetected + stats.detected,
      recordsWithMissingFields: Math.max(0, job.recordsWithMissingFields + stats.missingFields - missingResolved),
      recordsFiltered: job.recordsFiltered + stats.filtered,
      recordsFailed: job.recordsFailed + stats.failed,
      updatedAt: now,
    };

    const reachedRecordLimit =
      job.schema.pagination.maxRecords !== undefined &&
      updated.totalExtracted >= job.schema.pagination.maxRecords;

    if (context.tripped) {
      await this.finalizeInTransaction(updated, 'COMPLETED', {
        stopReason: 'no_new_records',
        now,
      });
      return {
        ack: { status: 'committed', sequence, inserted: rows.length, duplicates, shouldStop: true },
        job: updated,
      };
    }

    if (reachedRecordLimit) {
      machine.transition({ type: 'FINISH' });
      updated.status = machine.getState();
      await this.finalizeInTransaction(updated, 'COMPLETED', {
        stopReason: 'max_records_reached',
        now,
      });
      return {
        ack: { status: 'committed', sequence, inserted: rows.length, duplicates, shouldStop: true },
        job: updated,
      };
    }

    await this.jobs.saveJob(updated);
    await this.applyNavigationToCheckpoint(job.id, navigation, now);

    return {
      ack: { status: 'committed', sequence, inserted: rows.length, duplicates },
      job: updated,
    };
  }

  /** Records that the page is about to leave, before it does. */
  public async commitCheckpoint(payload: JobCheckpointPayload, sender: MessageSenderInfo): Promise<BatchAck> {
    const { identity, navigation } = payload;
    try {
      return await this.db.transaction('rw', this.db.jobs, this.db.checkpoints, async () => {
        const job = await this.jobs.getJob(identity.jobId);
        const rejection = this.validateSender(job, identity, sender);
        if (rejection || !job) {
          return rejectedAck(job?.lastSequence ?? 0, rejection ?? 'unknown_job');
        }
        const now = this.now();
        await this.applyNavigationToCheckpoint(job.id, navigation, now);
        await this.db.jobs.update(job.id, { updatedAt: now });
        return {
          status: 'committed' as const,
          sequence: job.lastSequence,
          inserted: 0,
          duplicates: 0,
        };
      });
    } catch (error: unknown) {
      this.report('STORAGE_FAILED', error, { jobId: identity.jobId });
      return rejectedAck(0, 'persist_failed');
    }
  }

  public async completeJob(payload: JobFinishedPayload, sender: MessageSenderInfo): Promise<BatchAck> {
    const { identity, stopReason, lastSequence } = payload;
    const job = await this.db.transaction(
      'rw',
      [this.db.jobs, this.db.checkpoints, this.db.history],
      async () => {
        const current = await this.jobs.getJob(identity.jobId);
        if (this.validateSender(current, identity, sender) || !current) return null;
        // A completion cannot overtake a batch that has not been stored.
        if (lastSequence !== current.lastSequence) return null;

        const machine = ExtractionStateMachine.fromJob(current);
        machine.transition({ type: 'FINISH' });
        const updated = { ...current, status: machine.getState() };
        await this.finalizeInTransaction(updated, 'COMPLETED', { stopReason, now: this.now() });
        return updated;
      }
    );

    if (!job) {
      return rejectedAck(lastSequence, 'job_not_active');
    }
    await this.notify(job);
    return { status: 'committed', sequence: lastSequence, inserted: 0, duplicates: 0 };
  }

  public async reportJobFailure(payload: JobFailedPayload, sender: MessageSenderInfo): Promise<BatchAck> {
    const { identity, message, category, code, recoverable } = payload;
    const current = await this.jobs.getJob(identity.jobId);
    const rejection = this.validateSender(current, identity, sender);
    if (rejection || !current) {
      return rejectedAck(0, rejection ?? 'unknown_job');
    }

    if (recoverable) {
      await this.interruptJob(identity.jobId, message);
    } else {
      await this.failJob(identity.jobId, message, category, code);
    }
    return { status: 'committed', sequence: current.lastSequence, inserted: 0, duplicates: 0 };
  }

  /**
   * A new document loaded in a tab. If a job is running there, this decides whether it
   * is the page the job was waiting for, and continues the job from its checkpoint.
   */
  public async handleContentReady(url: string, tabId: number): Promise<void> {
    const job = await this.jobs.findActiveJobForTab(tabId);
    if (!job) return;
    const checkpoint = await this.jobs.getCheckpoint(job.id);
    if (!checkpoint) return;

    const type = job.schema.pagination.type;
    const isExpected =
      !checkpoint.expectedUrl ||
      normalizeUrlForDeduplication(url) === normalizeUrlForDeduplication(checkpoint.expectedUrl);

    if (!isSameOrigin(url, checkpoint.startUrl)) {
      await this.interruptJob(job.id, `The tab left the site being extracted (now on ${url}).`);
      return;
    }

    if (type === 'url_template' && (!checkpoint.awaitingNavigation || !isExpected)) {
      await this.failJob(
        job.id,
        `Unexpected URL for page ${checkpoint.nextPage}: expected ${checkpoint.expectedUrl ?? 'no navigation'}, received ${url}.`,
        'PAGINATION_FAILED'
      );
      return;
    }

    // Next-button pages can redirect or load through script, so any same-site document
    // in this tab continues the job. Other jobs were not expecting to leave the page.
    if (!checkpoint.awaitingNavigation && type !== 'next_button') {
      await this.interruptJob(job.id, 'The page was reloaded or changed during extraction.');
      return;
    }

    const now = this.now();
    const updatedCheckpoint: JobCheckpoint = {
      ...checkpoint,
      currentUrl: url,
      awaitingNavigation: job.status === 'PAUSED',
      expectedUrl: job.status === 'PAUSED' ? url : undefined,
      navigationStartedAt: undefined,
      updatedAt: now,
    };
    await this.duringHandoff(job.tabId, async () => {
      await this.jobs.saveCheckpoint(updatedCheckpoint);

      // A paused job stays parked on the new page until the user resumes it.
      if (job.status === 'PAUSED') return;

      try {
        await this.db.jobs.update(job.id, { updatedAt: now });
        await this.sendExtract(job, updatedCheckpoint);
      } catch (error: unknown) {
        await this.interruptJob(job.id, `The page could not continue: ${toMessage(error)}`);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Browser events and reconciliation
  // -------------------------------------------------------------------------

  public async handleTabClosed(tabId: number): Promise<void> {
    const job = await this.jobs.findActiveJobForTab(tabId);
    if (job) {
      await this.interruptJob(job.id, 'The tab running this extraction was closed.');
    }
  }

  /**
   * A tab finished loading. If its job is still waiting for a page after a grace
   * period, the content script never arrived, which means the load failed.
   */
  public async handleTabLoaded(tabId: number): Promise<void> {
    const job = await this.jobs.findActiveJobForTab(tabId);
    if (!job) return;
    const checkpoint = await this.jobs.getCheckpoint(job.id);
    if (!checkpoint?.awaitingNavigation || job.status === 'PAUSED') return;

    this.schedule(() => {
      void this.checkPendingNavigation(job.id, tabId);
    }, this.pageLoadGraceMs);
  }

  public async checkPendingNavigation(jobId: string, tabId: number): Promise<void> {
    const job = await this.jobs.getJob(jobId);
    const checkpoint = await this.jobs.getCheckpoint(jobId);
    if (!job || !checkpoint?.awaitingNavigation || !isActiveJobStatus(job.status)) return;
    if (job.status === 'PAUSED' || job.tabId !== tabId) return;

    const status = await this.transport.getTabLoadStatus(tabId);
    if (status === 'loading') return; // Another load event will check again.

    const page = checkpoint.expectedUrl ? `The page ${checkpoint.expectedUrl}` : 'The next page';
    await this.interruptJob(jobId, `${page} failed to load.`);
  }

  /**
   * Brings stored job state back in line with reality.
   * - startup/installed: tabs and content scripts did not survive, so running jobs
   *   are interrupted.
   * - panel: each running job's tab is asked whether it is still working.
   * - every mode: abandoned recoverable sessions past their retention expire.
   */
  public async reconcile(mode: ReconcileMode): Promise<void> {
    const active = await this.jobs.findActiveJobs();

    if (mode === 'startup' || mode === 'installed') {
      const reason =
        mode === 'startup'
          ? 'The browser was closed during extraction.'
          : 'The extension was reloaded or updated during extraction.';
      for (const job of active) {
        await this.interruptJob(job.id, reason);
      }
    } else if (mode === 'panel') {
      for (const job of active) {
        await this.probeJob(job);
      }
    }

    await this.expireAbandonedJobs();
  }

  private async probeJob(job: ExtractionJob): Promise<void> {
    if (job.status === 'PAUSED' || this.isHandingOff(job)) return;
    const now = this.now();
    if (now - job.updatedAt < RECONCILE_QUIET_MS) return;

    const checkpoint = await this.jobs.getCheckpoint(job.id);
    if (
      checkpoint?.awaitingNavigation &&
      now - (checkpoint.navigationStartedAt ?? checkpoint.updatedAt) < NAVIGATION_STALE_MS
    ) {
      return;
    }

    let status: JobRunStatus | null = null;
    if (job.tabId !== undefined) {
      try {
        const reply = await this.transport.sendToTab(job.tabId, this.buildMessage({
          type: 'QUERY_JOB_RUN',
          payload: {},
        }));
        const parsed = JobRunStatusSchema.safeParse(reply);
        status = parsed.success ? parsed.data : null;
      } catch {
        status = null;
      }
    }

    if (status?.active && status.jobId === job.id) return;

    // The answer only counts if the job is still as it was when the page was asked.
    const latest = await this.jobs.getJob(job.id);
    if (
      !latest ||
      latest.updatedAt !== job.updatedAt ||
      latest.generation !== job.generation ||
      this.isHandingOff(latest)
    ) {
      return;
    }
    await this.interruptJob(job.id, 'The page stopped responding during extraction.');
  }

  private async expireAbandonedJobs(): Promise<void> {
    const now = this.now();
    for (const job of await this.jobs.findRecoverableJobs()) {
      const checkpoint = await this.jobs.getCheckpoint(job.id);
      if (!checkpoint || checkpoint.expiresAt <= now) {
        await this.expireJob(job.id);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle internals
  // -------------------------------------------------------------------------

  public async interruptJob(jobId: string, reason: string): Promise<void> {
    const job = await this.db.transaction(
      'rw',
      [this.db.jobs, this.db.checkpoints, this.db.history],
      async () => {
        const current = await this.jobs.getJob(jobId);
        if (!current || !canTransition(current.status, 'INTERRUPT')) return null;

        const now = this.now();
        const machine = ExtractionStateMachine.fromJob(current);
        machine.transition({ type: 'INTERRUPT', reason });

        const checkpoint = await this.jobs.getCheckpoint(jobId);
        const interrupted: ExtractionJob = {
          ...current,
          status: machine.getState(),
          generation: generateToken('gen'),
          interruptedReason: reason,
          interruptedAt: now,
          updatedAt: now,
          errors: appendError(current.errors, this.buildError('RUNTIME_MESSAGING', reason, 'WARN', { jobId })),
        };

        if (!checkpoint) {
          machine.transition({ type: 'FAIL', error: reason });
          interrupted.status = machine.getState();
          await this.finalizeInTransaction(interrupted, 'FAILED', { errorMessage: reason, now });
          return interrupted;
        }

        machine.transition({ type: 'MARK_RECOVERABLE' });
        interrupted.status = machine.getState();
        await this.jobs.saveJob(interrupted);
        return interrupted;
      }
    );

    if (job) {
      await this.notify(job);
    }
  }

  private async failJob(
    jobId: string,
    message: string,
    category: ErrorCategory,
    code?: ExtractionErrorCode
  ): Promise<void> {
    const reported = this.report(category, message, { jobId }, code);
    const job = await this.db.transaction(
      'rw',
      [this.db.jobs, this.db.checkpoints, this.db.history],
      async () => {
        const current = await this.jobs.getJob(jobId);
        if (!current || !canTransition(current.status, 'FAIL')) return null;

        const machine = ExtractionStateMachine.fromJob(current);
        machine.transition({ type: 'FAIL', error: message });
        const updated: ExtractionJob = {
          ...current,
          status: machine.getState(),
          errors: appendError(current.errors, reported),
        };
        await this.finalizeInTransaction(updated, 'FAILED', { errorMessage: message, now: this.now() });
        return updated;
      }
    );

    if (job) {
      await this.notify(job);
      await this.transport.broadcast(
        this.buildMessage({ type: 'EXTRACTION_ERROR', payload: reported })
      ).catch(() => undefined);
    }
  }

  private async expireJob(jobId: string): Promise<void> {
    const job = await this.db.transaction(
      'rw',
      [this.db.jobs, this.db.checkpoints, this.db.history],
      async () => {
        const current = await this.jobs.getJob(jobId);
        if (!current || !canTransition(current.status, 'EXPIRE')) return null;

        const machine = ExtractionStateMachine.fromJob(current);
        machine.transition({ type: 'EXPIRE' });
        const updated = { ...current, status: machine.getState() };
        await this.finalizeInTransaction(updated, 'EXPIRED', {
          stopReason: 'session_expired',
          now: this.now(),
        });
        return updated;
      }
    );
    if (job) {
      await this.notify(job);
    }
  }

  private async endJobByUser(
    jobId: string,
    event: 'CANCEL' | 'FINISH',
    status: JobStatus,
    stopReason: string
  ): Promise<JobCommandResult> {
    let ended: { job: ExtractionJob; runningAs: JobIdentity } | null;
    try {
      ended = await this.db.transaction(
        'rw',
        [this.db.jobs, this.db.checkpoints, this.db.history],
        async () => {
          const current = await this.jobs.getJob(jobId);
          if (!current || !canTransition(current.status, event)) return null;

          const runningAs = this.identityOf(current);
          const machine = ExtractionStateMachine.fromJob(current);
          machine.transition({ type: event });
          const job = { ...current, status: machine.getState() };
          await this.finalizeInTransaction(job, status, { stopReason, now: this.now() });
          return { job, runningAs };
        }
      );
    } catch (error: unknown) {
      this.report('STORAGE_FAILED', error, { jobId });
      return { ok: false, error: toMessage(error) };
    }

    if (!ended) {
      return { ok: false, error: 'This job is no longer running.' };
    }

    // The job is already durably ended. This only stops the page sooner, so a missing
    // tab is fine, and anything the page still sends will be rejected as stale.
    if (ended.job.tabId !== undefined) {
      await this.transport
        .sendToTab(ended.job.tabId, this.buildMessage({
          type: 'CONTROL_JOB',
          payload: { identity: ended.runningAs, action: 'abort' },
        }))
        .catch(() => undefined);
    }
    await this.notify(ended.job);
    return { ok: true, identity: this.identityOf(ended.job) };
  }

  /**
   * Writes a terminal job, its history row, and removes the resumable checkpoint.
   * Must run inside a transaction covering jobs, checkpoints and history.
   */
  private async finalizeInTransaction(
    job: ExtractionJob,
    status: JobStatus,
    outcome: { stopReason?: string; errorMessage?: string; now: number }
  ): Promise<void> {
    job.status = status;
    job.finishedAt = outcome.now;
    job.updatedAt = outcome.now;
    // Replacing the generation makes every later message from this run stale.
    job.generation = generateToken('ended');
    job.stopReason = outcome.stopReason ?? job.stopReason;
    job.errorMessage = outcome.errorMessage ?? job.errorMessage;
    if (job.pausedAt) {
      job.pausedMs += Math.max(0, outcome.now - job.pausedAt);
      job.pausedAt = undefined;
    }
    await this.jobs.saveJob(job);
    await this.jobs.deleteCheckpoint(job.id);

    const run: ExtractionRunHistory = {
      id: `history_${job.id}`,
      jobId: job.id,
      projectId: job.projectId,
      datasetId: job.datasetId ?? '',
      recipeId: job.recipeId,
      name: job.schema.name,
      url: job.targetUrl,
      status,
      totalExtracted: job.totalExtracted,
      duplicatesSkipped: job.duplicatesSkipped,
      pagesVisited: job.pagesVisited,
      scrollsCompleted: job.scrollsCompleted,
      recordsDetected: job.recordsDetected,
      recordsWithMissingFields: job.recordsWithMissingFields,
      recordsFiltered: job.recordsFiltered,
      recordsFailed: job.recordsFailed,
      stopReason: job.stopReason,
      startedAt: job.startedAt,
      finishedAt: outcome.now,
      errorMessage: job.errorMessage,
    };
    await this.history.recordRun(run);
  }

  private async applyTransition(
    jobId: string,
    event: 'PAUSE' | 'RESUME',
    mutate: (job: ExtractionJob) => void
  ): Promise<{ ok: boolean; job?: ExtractionJob; error?: string }> {
    try {
      return await this.db.transaction('rw', this.db.jobs, async () => {
        const current = await this.jobs.getJob(jobId);
        if (!current || !canTransition(current.status, event)) {
          return { ok: false, error: 'This job cannot do that in its current state.' };
        }
        const machine = ExtractionStateMachine.fromJob(current);
        machine.transition({ type: event });
        const updated: ExtractionJob = {
          ...current,
          status: machine.getState(),
          updatedAt: this.now(),
        };
        mutate(updated);
        await this.jobs.saveJob(updated);
        return { ok: true, job: updated };
      });
    } catch (error: unknown) {
      this.report('STORAGE_FAILED', error, { jobId });
      return { ok: false, error: toMessage(error) };
    }
  }

  private async applyNavigationToCheckpoint(
    jobId: string,
    navigation: JobNavigationState,
    now: number
  ): Promise<void> {
    const checkpoint = await this.jobs.getCheckpoint(jobId);
    if (!checkpoint) return;
    await this.jobs.saveCheckpoint({
      ...checkpoint,
      currentUrl: navigation.url,
      nextPage: navigation.nextPage,
      scrollsCompleted: navigation.scrollsCompleted,
      visitedUrls: navigation.visitedUrls,
      awaitingNavigation: navigation.awaitingNavigation,
      expectedUrl: navigation.expectedUrl,
      navigationStartedAt: navigation.awaitingNavigation ? now : undefined,
      updatedAt: now,
    });
  }

  private validateSender(
    job: ExtractionJob | undefined,
    identity: JobIdentity,
    sender: MessageSenderInfo
  ): BatchRejectionReason | null {
    if (!job) return 'unknown_job';
    if (
      job.projectId !== identity.projectId ||
      job.datasetId !== identity.datasetId ||
      job.runId !== identity.runId
    ) {
      return 'identity_mismatch';
    }
    if (!isActiveJobStatus(job.status)) return 'job_not_active';
    if (job.generation !== identity.generation) return 'stale_generation';
    if (job.tabId !== undefined && sender.tabId !== job.tabId) return 'wrong_tab';
    return null;
  }

  private resumeUrlFor(job: ExtractionJob, checkpoint: JobCheckpoint): string {
    switch (job.schema.pagination.type) {
      case 'infinite_scroll':
        return checkpoint.startUrl;
      case 'url_template':
        return checkpoint.expectedUrl ?? checkpoint.currentUrl;
      default:
        return checkpoint.awaitingNavigation && checkpoint.expectedUrl
          ? checkpoint.expectedUrl
          : checkpoint.currentUrl;
    }
  }

  private identityOf(job: ExtractionJob): JobIdentity {
    return {
      jobId: job.id,
      projectId: job.projectId ?? '',
      datasetId: job.datasetId ?? '',
      runId: job.runId ?? job.id,
      generation: job.generation ?? '',
    };
  }

  /** Identical configurations share one schema row instead of adding one per job. */
  private async stableSchemaId(recipe: ExtractionSchema): Promise<string> {
    const digest = await this.hash(
      JSON.stringify([recipe.containerSelector, recipe.fields, recipe.pagination])
    );
    return `schema_${digest.slice(0, 24)}`;
  }

  private async sendExtract(job: ExtractionJob, checkpoint: JobCheckpoint): Promise<void> {
    if (job.tabId === undefined) {
      throw new Error('The job has no tab to run in.');
    }
    await this.transport.sendToTab(
      job.tabId,
      this.buildMessage({
        type: 'EXTRACT_RECORDS',
        payload: {
          identity: this.identityOf(job),
          recipe: job.schema,
          resume: {
            page: checkpoint.nextPage,
            nextSequence: job.lastSequence + 1,
            recordsExtracted: job.totalExtracted,
            scrollsCompleted: checkpoint.scrollsCompleted,
            catchUpScrolls: checkpoint.catchUpScrolls,
            visitedUrls: checkpoint.visitedUrls,
            startUrl: checkpoint.startUrl,
          },
        },
      })
    );
  }

  /** Returns whether a live run in the page applied the control. */
  private async sendControl(job: ExtractionJob, action: 'pause' | 'resume'): Promise<boolean> {
    if (job.tabId === undefined) return false;
    try {
      const reply = await this.transport.sendToTab(
        job.tabId,
        this.buildMessage({
          type: 'CONTROL_JOB',
          payload: { identity: this.identityOf(job), action },
        })
      );
      return (reply as { accepted?: unknown } | undefined)?.accepted === true;
    } catch {
      return false;
    }
  }

  private async notify(job: ExtractionJob): Promise<void> {
    await this.transport
      .broadcast(
        this.buildMessage({
          type: 'JOB_UPDATED',
          payload: {
            jobId: job.id,
            datasetId: job.datasetId,
            tabId: job.tabId,
            status: job.status,
            progressKind: job.progressKind,
            currentStep: currentStepOf(job),
            targetSteps: job.targetSteps,
            recordsExtracted: job.totalExtracted,
            duplicatesCount: job.duplicatesSkipped,
            stopReason: job.stopReason,
            errorMessage: job.errorMessage,
            timestamp: this.now(),
          },
        })
      )
      // No open side panel is a normal state. It reads the job when it opens.
      .catch(() => undefined);
  }

  private buildMessage<T extends ExtensionMessage['type']>(
    message: { type: T; payload: unknown }
  ): Extract<ExtensionMessage, { type: T }> {
    return extensionMessageSchema.parse({
      id: messageId(message.type.toLowerCase()),
      timestamp: this.now(),
      ...message,
    }) as Extract<ExtensionMessage, { type: T }>;
  }

  private report(
    category: ErrorCategory,
    error: unknown,
    context: Record<string, unknown>,
    code?: ExtractionErrorCode
  ): HarvestError {
    return this.reporter.report(category, error, { context, code });
  }

  private buildError(
    category: ErrorCategory,
    message: string,
    severity: HarvestError['severity'],
    context: Record<string, unknown>
  ): HarvestError {
    return this.reporter.report(category, message, { severity, context });
  }
}

interface PreparedRecord {
  record: RecordBatchPayload['records'][number];
  index: number;
  canonical: string;
  hash: string;
  /** The canonical form of an earlier read of this row, which this one fills in. */
  supersedes?: string;
  supersededHash?: string;
}

interface CommitOutcome {
  ack: BatchAck;
  job?: ExtractionJob;
}

class JobConflictError extends Error {}

function rejectedAck(sequence: number, reason: BatchRejectionReason): BatchAck {
  return { status: 'rejected', sequence, inserted: 0, duplicates: 0, reason };
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toCommandResult(result: { ok: boolean; error?: string }): JobCommandResult {
  return { ok: result.ok, error: result.error };
}

function appendError(errors: HarvestError[], error: HarvestError): HarvestError[] {
  return [...errors, error].slice(-MAX_STORED_ERRORS);
}

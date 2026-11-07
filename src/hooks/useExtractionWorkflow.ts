import { CandidateKind, ListCandidate } from '@/shared/contracts/message';
import type { MultiAnchorSelector } from '@/shared/contracts/selector';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { messagingService, TabInfo } from '@/services/messaging';
import {
  ExtractionJob,
  JobProgressKind,
  isActiveJobStatus,
  isTerminalJobStatus,
} from '@/shared/contracts/job';
import { ExtractionProject } from '@/shared/contracts/project';
import type { ExtractionErrorCode } from '@/shared/contracts/error';
import { codeForCategory } from '@/core/resilience/error-reporter';
import { ExtractionSchema } from '@/shared/contracts/schema';
import {
  DatasetRepository,
  JobRepository,
  ProjectRepository,
  RecipeRepository,
  RecordRepository,
  SettingsRepository,
} from '@/storage/repositories';
import {
  FieldDefinition,
  ExtractionRecipe,
  ExtractedRecord,
  Dataset,
  ExtractionPaginationConfig,
  ExtractionStatus,
} from '@/types';
import { ExtensionMessage, FieldPreviewResult } from '@/contracts/messages';

export type WorkflowView =
  | 'dashboard'
  | 'inspecting'
  | 'review_list'
  | 'config_fields'
  | 'extracting'
  | 'results'
  | 'history'
  | 'settings';

export interface InspectedElement {
  selector: string;
  tagName: string;
  classList: string[];
  textSnippet?: string;
}

export interface DetectedList {
  containerSelector: string;
  /** Multi-tier fallback ladder of the detected repeating item selector. */
  containerAnchor?: MultiAnchorSelector;
  matchCount: number;
  sampleSnippets: string[];
  /** Everything on the page the user could choose instead, best first. */
  candidates?: ListCandidate[];
  /** False when nothing on the page looks like data. */
  credible?: boolean;
  kind?: CandidateKind;
  dedupeFields?: string[];
}

/** An error the panel shows. The code picks the explanation; the message is detail. */
export interface OperationError {
  message: string;
  code?: ExtractionErrorCode;
}

export interface ExtractionStats {
  progressKind: JobProgressKind;
  currentStep: number;
  targetSteps: number;
  totalExtracted: number;
  duplicatesSkipped: number;
  recordsDetected: number;
  recordsWithMissingFields: number;
  recordsFiltered: number;
  recordsFailed: number;
  elapsedSeconds: number;
  status: ExtractionStatus;
  errorMessage?: string;
  /** The code of the job's latest error, for the panel's explanation (ADR-031). */
  errorCode?: ExtractionErrorCode;
  stopReason?: string;
}

const IDLE_STATS: ExtractionStats = {
  progressKind: 'single',
  currentStep: 0,
  targetSteps: 1,
  totalExtracted: 0,
  duplicatesSkipped: 0,
  recordsDetected: 0,
  recordsWithMissingFields: 0,
  recordsFiltered: 0,
  recordsFailed: 0,
  elapsedSeconds: 0,
  status: 'IDLE',
};

const REFRESH_INTERVAL_MS = 1000;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The code of the job's latest error. Errors stored before ADR-031 have no code, so they get
 * the default for their category, the same one the reporter would give them today.
 */
function latestErrorCode(job: ExtractionJob): ExtractionErrorCode | undefined {
  const latest = job.errors.at(-1);
  if (!latest) return undefined;
  return latest.code ?? codeForCategory(latest.category);
}

export function statsFromJob(job: ExtractionJob, now: number = Date.now()): ExtractionStats {
  const endedAt = job.finishedAt ?? job.pausedAt ?? now;
  return {
    progressKind: job.progressKind,
    currentStep: job.progressKind === 'scrolls' ? job.scrollsCompleted : job.pagesVisited,
    targetSteps: job.targetSteps ?? 1,
    totalExtracted: job.totalExtracted,
    duplicatesSkipped: job.duplicatesSkipped,
    recordsDetected: job.recordsDetected,
    recordsWithMissingFields: job.recordsWithMissingFields,
    recordsFiltered: job.recordsFiltered,
    recordsFailed: job.recordsFailed,
    elapsedSeconds: Math.max(0, Math.floor((endedAt - job.startedAt - job.pausedMs) / 1000)),
    status: job.status,
    errorMessage: job.errorMessage,
    errorCode: latestErrorCode(job),
    stopReason: job.stopReason,
  };
}

/**
 * The side panel's workflow. For extraction it is a view of stored state: the background
 * owns every job, this hook sends it commands and reads the results from IndexedDB, so
 * closing and reopening the panel loses nothing and changes nothing.
 */
export function useExtractionWorkflow(tab: TabInfo) {
  const repositories = useMemo(
    () => ({
      datasets: new DatasetRepository(),
      jobs: new JobRepository(),
      projects: new ProjectRepository(),
      recipes: new RecipeRepository(),
      records: new RecordRepository(),
      settings: new SettingsRepository(),
    }),
    []
  );

  const [view, setView] = useState<WorkflowView>('dashboard');
  const [inspectedElement, setInspectedElement] = useState<InspectedElement | null>(null);
  const [detectedList, setDetectedList] = useState<DetectedList | null>(null);
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [selectedFieldIds, setSelectedFieldIds] = useState<Set<string>>(new Set());
  const [pagination, setPagination] = useState<ExtractionPaginationConfig>({
    type: 'none',
    maxPages: 20,
    delayMs: 1500,
    scrollCount: 30,
    scrollDelayMs: 1500,
    startPage: 1,
    pageIncrement: 1,
  });
  const [records, setRecords] = useState<ExtractedRecord[]>([]);
  const [recordsRevision, setRecordsRevision] = useState(0);
  const [currentDataset, setCurrentDataset] = useState<Dataset | null>(null);
  const [stats, setStats] = useState<ExtractionStats>(IDLE_STATS);
  const [operationError, setOperationError] = useState<OperationError | null>(null);
  const [recoverableJobs, setRecoverableJobs] = useState<ExtractionJob[]>([]);
  const [activeJob, setActiveJob] = useState<ExtractionJob | null>(null);
  const [projects, setProjects] = useState<ExtractionProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(undefined);
  const [activeRecipeId, setActiveRecipeId] = useState<string | undefined>(undefined);
  const [runSummary, setRunSummary] = useState<ExtractionStats | null>(null);
  const [recordWarningThreshold, setRecordWarningThreshold] = useState<number | undefined>(undefined);

  // The job this panel is displaying. Commands and storage decide what it does; this
  // only decides which job's state is on screen.
  const followedJobIdRef = useRef<string | null>(null);
  const pickerActiveRef = useRef(false);
  // Pagination settings the person, or a recipe they loaded, has set. Saved defaults arrive
  // asynchronously when the panel opens and must never overwrite these.
  const setPaginationKeysRef = useRef(new Set<keyof ExtractionPaginationConfig>());

  const handleOperationError = useCallback((error: unknown, fallbackView: WorkflowView) => {
    const message = errorText(error);
    console.warn('PageHarvest operation failed:', message);
    setOperationError({ message });
    setView(fallbackView);
  }, []);

  const refreshRecoverableJobs = useCallback(async () => {
    setRecoverableJobs(await repositories.jobs.findRecoverableJobs());
  }, [repositories]);

  const loadDataset = useCallback(
    async (datasetId: string) => {
      const dataset = await repositories.datasets.getDataset(datasetId);
      const rows = await repositories.datasets.getRecordsByDataset(datasetId);
      const job = dataset?.jobId ? await repositories.jobs.getJob(dataset.jobId) : undefined;
      setCurrentDataset(dataset ?? null);
      if (dataset) {
        setFields(dataset.fields);
        setSelectedFieldIds(new Set(dataset.fields.map((f) => f.id)));
      }
      setRunSummary(job ? statsFromJob(job) : null);
      setRecords(rows);
      setRecordsRevision((revision) => revision + 1);
    },
    [repositories]
  );

  /** Re-reads the followed job from storage and moves the view to match it. */
  const refreshFollowedJob = useCallback(async () => {
    const jobId = followedJobIdRef.current;
    if (!jobId) return;

    const job = await repositories.jobs.getJob(jobId);
    // The panel may have stopped following this job while the read was in progress.
    if (!job || followedJobIdRef.current !== jobId) return;

    setActiveJob(job);
    setStats(statsFromJob(job));

    if (job.status === 'RECOVERABLE' || job.status === 'INTERRUPTED') {
      followedJobIdRef.current = null;
      setActiveJob(null);
      setView('dashboard');
      await refreshRecoverableJobs();
      return;
    }

    if (job.status === 'COMPLETED' && job.datasetId) {
      followedJobIdRef.current = null;
      setActiveJob(null);
      await loadDataset(job.datasetId);
      setView('results');
    }
  }, [loadDataset, refreshRecoverableJobs, repositories]);

  const followJob = useCallback(
    async (job: ExtractionJob) => {
      followedJobIdRef.current = job.id;
      setActiveJob(job);
      setActiveRecipeId(job.recipeId);
      setStats(statsFromJob(job));
      if (job.datasetId) {
        setCurrentDataset((await repositories.datasets.getDataset(job.datasetId)) ?? null);
      }
      setView('extracting');
      await refreshFollowedJob();
    },
    [refreshFollowedJob, repositories]
  );

  // On open: apply saved preferences, then show whatever storage says is happening.
  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      try {
        const settings = await repositories.settings.getSettings();
        if (cancelled) return;
        setPagination((prev) => {
          const chosen = setPaginationKeysRef.current;
          return {
            ...prev,
            maxPages: chosen.has('maxPages') ? prev.maxPages : settings.defaultMaxPages,
            delayMs: chosen.has('delayMs') ? prev.delayMs : settings.defaultDelayMs,
            scrollCount: chosen.has('scrollCount') ? prev.scrollCount : settings.defaultMaxScrolls,
            scrollDelayMs: chosen.has('scrollDelayMs') ? prev.scrollDelayMs : settings.defaultScrollDelayMs,
          };
        });
        setRecordWarningThreshold(settings.maxRecordsWarningThreshold);
      } catch (err) {
        console.warn('Could not load settings:', err);
      }

      // A job can have outlived its page while no panel was open to notice.
      await messagingService.reconcileJobs().catch(() => undefined);
      if (cancelled) return;

      try {
        await refreshRecoverableJobs();
        const active = await repositories.jobs.findActiveJobs();
        if (!cancelled && active.length > 0 && !followedJobIdRef.current) {
          await followJob(active[0]);
        }
      } catch (err) {
        console.warn('Could not read job state:', err);
      }
    };

    void initialize();
    return () => {
      cancelled = true;
    };
  }, [followJob, refreshRecoverableJobs, repositories]);

  // Keep the display current while following a job. Broadcasts make it immediate; this
  // covers a missed one, and is what moves the elapsed time.
  const isFollowingActiveJob = activeJob !== null && isActiveJobStatus(activeJob.status);
  useEffect(() => {
    if (!isFollowingActiveJob) return undefined;
    const timer = setInterval(() => {
      void refreshFollowedJob();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isFollowingActiveJob, refreshFollowedJob]);

  // Listen to incoming messages
  useEffect(() => {
    const unsubscribe = messagingService.subscribe((message: ExtensionMessage) => {
      switch (message.type) {
        case 'ELEMENT_SELECTED': {
          const { selector, tagName, classList, textSnippet } = message.payload;
          setInspectedElement({ selector, tagName, classList, textSnippet });

          // Auto-trigger list detection using this selected element
          messagingService.detectRepeatedElements(selector).catch((err: unknown) => {
            setOperationError({ message: errorText(err) });
          });
          break;
        }

        case 'SELECTION_CANCELLED': {
          pickerActiveRef.current = false;
          setInspectedElement(null);
          setView((current) =>
            current === 'inspecting' || current === 'review_list' ? 'dashboard' : current
          );
          break;
        }

        case 'SELECTION_CONFIRMED': {
          pickerActiveRef.current = false;
          break;
        }

        case 'REPEATED_ELEMENTS_DETECTED': {
          const { containerSelector, containerAnchor, matchCount, sampleSnippets, candidates, credible } =
            message.payload;
          setOperationError(null);
          setDetectedList({
            containerSelector,
            containerAnchor,
            matchCount,
            sampleSnippets,
            candidates,
            credible,
            kind: candidates?.[0]?.kind,
            dedupeFields: candidates?.[0]?.dedupeFields,
          });
          setView('review_list');
          break;
        }

        case 'FIELDS_DETECTED': {
          const { suggestedFields } = message.payload;
          // Replaced even when empty, so columns of a previous list cannot carry over.
          setFields(suggestedFields);
          setSelectedFieldIds(
            new Set(suggestedFields.filter((f) => f.discovery?.suggested !== false).map((f) => f.id))
          );
          break;
        }

        case 'JOB_UPDATED': {
          if (message.payload.jobId === followedJobIdRef.current) {
            void refreshFollowedJob();
          }
          if (message.payload.status === 'RECOVERABLE' || isTerminalJobStatus(message.payload.status)) {
            void refreshRecoverableJobs();
          }
          break;
        }

        case 'EXTRACTION_ERROR': {
          setOperationError({ message: message.payload.message, code: message.payload.code });
          // Detection failed with no picker open, so there is nothing left to wait for.
          if (!pickerActiveRef.current) {
            setView((current) => (current === 'inspecting' ? 'dashboard' : current));
          }
          break;
        }

        default:
          break;
      }
    });

    return () => unsubscribe();
  }, [refreshFollowedJob, refreshRecoverableJobs]);

  /**
   * Visual Element Picker
   */
  const startVisualPicker = useCallback(async () => {
    try {
      setOperationError(null);
      setInspectedElement(null);
      setActiveRecipeId(undefined);
      setView('inspecting');
      pickerActiveRef.current = true;
      await messagingService.startElementPicker();
    } catch (err) {
      pickerActiveRef.current = false;
      handleOperationError(err, 'dashboard');
    }
  }, [handleOperationError]);

  const stopPickerQuietly = useCallback(async () => {
    if (!pickerActiveRef.current) return;
    pickerActiveRef.current = false;
    try {
      await messagingService.stopElementPicker();
    } catch (err) {
      console.warn('Could not cleanly stop element picker:', err);
    }
  }, []);

  const cancelVisualPicker = useCallback(async () => {
    await stopPickerQuietly();
    setView('dashboard');
  }, [stopPickerQuietly]);

  /**
   * Auto-Detect Lists
   */
  const autoDetectLists = useCallback(async () => {
    try {
      setOperationError(null);
      setActiveRecipeId(undefined);
      setView('inspecting');
      await messagingService.detectRepeatedElements();
    } catch (err) {
      handleOperationError(err, 'dashboard');
    }
  }, [handleOperationError]);

  const selectListCandidate = useCallback((candidate: ListCandidate) => {
    setDetectedList((current) => ({
      ...(current ?? {}),
      containerSelector: candidate.containerSelector,
      containerAnchor: candidate.containerAnchor,
      matchCount: candidate.matchCount,
      sampleSnippets: candidate.sampleSnippets,
      kind: candidate.kind,
      dedupeFields: candidate.dedupeFields,
    }));
  }, []);

  const startPresetDetection = useCallback(
    async (mode: 'table' | 'links') => {
      try {
        setOperationError(null);
        setActiveRecipeId(undefined);
        setView('inspecting');
        await messagingService.detectRepeatedElements(undefined, mode);
      } catch (err) {
        handleOperationError(err, 'dashboard');
      }
    },
    [handleOperationError]
  );

  const loadProjects = useCallback(async () => {
    setProjects(await repositories.projects.getAllProjects());
  }, [repositories]);

  /**
   * Confirm List Candidate and Request Fields
   */
  const confirmListCandidate = useCallback(
    async (candidate: DetectedList) => {
      // A picker left open would swallow the clicks pagination makes on the page.
      await stopPickerQuietly();
      setDetectedList(candidate);
      setView('config_fields');
      void loadProjects();

      try {
        await messagingService.detectFields(candidate.containerSelector, candidate.kind);
      } catch (err) {
        setFields([]);
        setSelectedFieldIds(new Set());
        handleOperationError(err, 'review_list');
      }
    },
    [handleOperationError, loadProjects, stopPickerQuietly]
  );

  /**
   * Field Management
   */
  const toggleFieldSelection = useCallback((id: string) => {
    setSelectedFieldIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const updateField = useCallback((id: string, updates: Partial<FieldDefinition>) => {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates } : f)));
  }, []);

  const addField = useCallback((newField: FieldDefinition) => {
    setFields((prev) => [...prev, newField]);
    setSelectedFieldIds((prev) => new Set(prev).add(newField.id));
  }, []);

  /** Swaps a column with its neighbour. The recipe keeps this order, so the export does too. */
  const moveField = useCallback((id: string, direction: -1 | 1) => {
    setFields((prev) => {
      const from = prev.findIndex((f) => f.id === id);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  }, []);

  /**
   * Reads real rows for these columns from the page (PREVIEW_FIELDS, ADR-030). Read-only:
   * nothing is stored and no job changes. Refused while this panel follows a job in this tab.
   */
  const previewFields = useCallback(
    async (columns: FieldDefinition[]): Promise<FieldPreviewResult> => {
      if (!detectedList) {
        return { ok: false, code: 'CONTAINER_NOT_FOUND', message: 'Choose a list on the page first.' };
      }
      if (activeJob && isActiveJobStatus(activeJob.status) && activeJob.tabId === tab.id) {
        return {
          ok: false,
          code: 'VALIDATION_ERROR',
          message: 'An extraction is running in this tab. The preview is available again when it finishes.',
        };
      }
      // The backup anchor is sent only so the page can say the list moved; nothing is written back.
      return messagingService.previewFields(detectedList.containerSelector, columns, {
        containerAnchor: detectedList.containerAnchor,
      });
    },
    [activeJob, detectedList, tab.id]
  );

  const removeField = useCallback((id: string) => {
    setFields((prev) => prev.filter((f) => f.id !== id));
    setSelectedFieldIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const buildRecipe = useCallback(
    (name: string): ExtractionRecipe | null => {
      if (!detectedList) return null;
      const now = Date.now();
      return {
        id: `recipe_${now}_${Math.random().toString(36).slice(2, 8)}`,
        name,
        urlPattern: tab.url,
        containerSelector: detectedList.containerSelector,
        containerAnchor: detectedList.containerAnchor,
        fields: fields.filter((f) => selectedFieldIds.has(f.id)),
        pagination,
        dedupeFields: detectedList.dedupeFields,
        projectId: selectedProjectId,
        createdAt: now,
        updatedAt: now,
      };
    },
    [detectedList, fields, pagination, selectedFieldIds, selectedProjectId, tab.url]
  );

  /**
   * Start Extraction Workflow
   */
  const startExtraction = useCallback(async () => {
    const recipe = buildRecipe(`${tab.title || 'Extraction'} - ${new Date().toLocaleDateString()}`);
    if (!recipe) return;

    if (recipe.fields.length === 0) {
      setOperationError({ message: 'Select at least one field to extract.', code: 'VALIDATION_ERROR' });
      return;
    }
    if (typeof tab.id !== 'number') {
      setOperationError({ message: 'There is no active tab to extract from.', code: 'VALIDATION_ERROR' });
      return;
    }

    setOperationError(null);
    setRecords([]);
    setStats({
      ...IDLE_STATS,
      status: 'CREATED',
      progressKind:
        pagination.type === 'infinite_scroll'
          ? 'scrolls'
          : pagination.type === 'none'
            ? 'single'
            : 'pages',
    });
    setView('extracting');

    try {
      const identity = await messagingService.startJob({
        recipe,
        tabId: tab.id,
        sourceUrl: tab.url,
        pageTitle: tab.title,
        projectId: selectedProjectId,
        recipeId: activeRecipeId,
      });
      const job = await repositories.jobs.getJob(identity.jobId);
      if (job) {
        await followJob(job);
      }
    } catch (err) {
      setStats(IDLE_STATS);
      handleOperationError(err, 'config_fields');
    }
  }, [
    activeRecipeId,
    buildRecipe,
    followJob,
    handleOperationError,
    pagination.type,
    repositories,
    selectedProjectId,
    tab.id,
    tab.title,
    tab.url,
  ]);

  const pauseExtraction = useCallback(async () => {
    const jobId = followedJobIdRef.current;
    if (!jobId) return;
    try {
      await messagingService.pauseJob(jobId);
      await refreshFollowedJob();
    } catch (err) {
      setOperationError({ message: errorText(err) });
    }
  }, [refreshFollowedJob]);

  const resumeExtraction = useCallback(async () => {
    const jobId = followedJobIdRef.current;
    if (!jobId) return;
    try {
      await messagingService.resumeJob(jobId);
      await refreshFollowedJob();
    } catch (err) {
      setOperationError({ message: errorText(err) });
    }
  }, [refreshFollowedJob]);

  /** "Finish & View Results": ends the job, keeping everything collected so far. */
  const stopExtraction = useCallback(async () => {
    const jobId = followedJobIdRef.current;
    if (!jobId) return;
    try {
      const job = await repositories.jobs.getJob(jobId);
      if (job && !isTerminalJobStatus(job.status)) {
        await messagingService.finishJob(jobId);
      }
      followedJobIdRef.current = null;
      setActiveJob(null);
      if (job?.datasetId) {
        await loadDataset(job.datasetId);
      }
      setView('results');
    } catch (err) {
      setOperationError({ message: errorText(err) });
    }
  }, [loadDataset, repositories]);

  /** Cancels the job. Records already committed stay in the dataset. */
  const cancelExtraction = useCallback(async () => {
    const jobId = followedJobIdRef.current;
    try {
      if (jobId) {
        const job = await repositories.jobs.getJob(jobId);
        if (job && !isTerminalJobStatus(job.status)) {
          await messagingService.cancelJob(jobId);
        }
      }
      followedJobIdRef.current = null;
      setActiveJob(null);
      setStats(IDLE_STATS);
      setInspectedElement(null);
      setDetectedList(null);
      setCurrentDataset(null);
      setRecords([]);
      setView('dashboard');
    } catch (err) {
      setOperationError({ message: errorText(err) });
    }
  }, [repositories]);

  const recoverJob = useCallback(
    async (jobId: string) => {
      try {
        setOperationError(null);
        await messagingService.recoverJob(jobId);
        await refreshRecoverableJobs();
        const job = await repositories.jobs.getJob(jobId);
        if (job) {
          await followJob(job);
        }
      } catch (err) {
        setOperationError({ message: errorText(err) });
        await refreshRecoverableJobs();
      }
    },
    [followJob, refreshRecoverableJobs, repositories]
  );

  const discardRecoverableJob = useCallback(
    async (jobId: string) => {
      try {
        setOperationError(null);
        await messagingService.discardJob(jobId);
        await refreshRecoverableJobs();
      } catch (err) {
        setOperationError({ message: errorText(err) });
      }
    },
    [refreshRecoverableJobs]
  );

  /**
   * Navigation to Saved Datasets & Viewing in Grid
   */
  const viewDatasetInTable = useCallback(
    async (dataset: Dataset) => {
      try {
        await loadDataset(dataset.id);
        setView('results');
      } catch (err) {
        setOperationError({ message: errorText(err) });
      }
    },
    [loadDataset]
  );

  const resetToDashboard = useCallback(() => {
    followedJobIdRef.current = null;
    setActiveJob(null);
    setActiveRecipeId(undefined);
    setOperationError(null);
    setStats(IDLE_STATS);
    setView('dashboard');
    setInspectedElement(null);
    setDetectedList(null);
    setCurrentDataset(null);
    setRecords([]);
  }, []);

  const updateRecordCell = useCallback(
    async (recordId: string, fieldName: string, value: string | number | null) => {
      await repositories.records.updateCell(recordId, fieldName, value);
      setRecords((prev) =>
        prev.map((r) => (r._id === recordId ? { ...r, [fieldName]: value } : r))
      );
    },
    [repositories]
  );

  const deleteRecord = useCallback(
    async (recordId: string) => {
      const datasetId = currentDataset?.id;
      if (!datasetId) return;
      await repositories.records.deleteRecord(recordId, datasetId);
      setRecords((prev) => prev.filter((r) => r._id !== recordId));
    },
    [currentDataset?.id, repositories]
  );

  /** Persists a grid edit as one transaction. Rejects if nothing was saved. */
  const applyDatasetEdit = useCallback(
    async (nextRecords: ExtractedRecord[], nextFields?: FieldDefinition[]) => {
      const datasetId = currentDataset?.id;
      if (!datasetId) return;
      const nextColumns = nextFields ?? fields;
      await repositories.datasets.applyEdit(datasetId, nextRecords, nextColumns);
      setRecords(nextRecords);
      setFields(nextColumns);
    },
    [currentDataset?.id, fields, repositories]
  );

  /** Saves the current configuration as a reusable recipe. Rejects if it was not saved. */
  const saveCurrentAsRecipe = useCallback(
    async (name: string) => {
      const recipe = buildRecipe(name.trim());
      if (!recipe) {
        throw new Error('Choose a list before saving a recipe.');
      }
      if (recipe.fields.length === 0) {
        throw new Error('Select at least one column before saving a recipe.');
      }
      await repositories.recipes.saveRecipe(recipe);
      setActiveRecipeId(recipe.id);
    },
    [buildRecipe, repositories]
  );

  const applyConfiguration = useCallback(
    (config: {
      containerSelector: string;
      containerAnchor?: MultiAnchorSelector;
      fields: FieldDefinition[];
      pagination?: ExtractionPaginationConfig;
      projectId?: string;
      dedupeFields?: string[];
    }) => {
      setOperationError(null);
      setDetectedList({
        containerSelector: config.containerSelector,
        // Kept so a run, a preview and a re-saved recipe still have the list's backup ladder.
        containerAnchor: config.containerAnchor,
        matchCount: 0,
        sampleSnippets: [],
        dedupeFields: config.dedupeFields,
      });
      setFields(config.fields);
      setSelectedFieldIds(new Set(config.fields.map((f) => f.id)));
      if (config.pagination) {
        const loaded = config.pagination;
        (Object.keys(loaded) as (keyof ExtractionPaginationConfig)[]).forEach((key) =>
          setPaginationKeysRef.current.add(key)
        );
        setPagination(loaded);
      }
      setSelectedProjectId(config.projectId);
      void loadProjects();
      setView('config_fields');
    },
    [loadProjects]
  );

  /** A change made on the Pagination step. What it sets is kept over the saved defaults. */
  const updatePagination = useCallback((updates: Partial<ExtractionPaginationConfig>) => {
    (Object.keys(updates) as (keyof ExtractionPaginationConfig)[]).forEach((key) =>
      setPaginationKeysRef.current.add(key)
    );
    setPagination((prev) => ({ ...prev, ...updates }));
  }, []);

  const loadRecipe = useCallback(
    (recipe: ExtractionRecipe) => {
      applyConfiguration(recipe);
      setActiveRecipeId(recipe.id);
    },
    [applyConfiguration]
  );

  const loadSchema = useCallback(
    (schema: ExtractionSchema) => {
      applyConfiguration(schema);
      setActiveRecipeId(undefined);
    },
    [applyConfiguration]
  );

  return {
    view,
    setView,
    inspectedElement,
    detectedList,
    fields,
    selectedFieldIds,
    pagination,
    updatePagination,
    records,
    recordsRevision,
    currentDataset,
    stats,
    runSummary,
    recordWarningThreshold,
    operationError,
    clearOperationError: useCallback(() => setOperationError(null), []),
    recoverableJobs,
    projects,
    selectedProjectId,
    setSelectedProjectId,
    startVisualPicker,
    cancelVisualPicker,
    autoDetectLists,
    startPresetDetection,
    selectListCandidate,
    confirmListCandidate,
    toggleFieldSelection,
    updateField,
    addField,
    moveField,
    previewFields,
    removeField,
    startExtraction,
    pauseExtraction,
    resumeExtraction,
    stopExtraction,
    cancelExtraction,
    recoverJob,
    discardRecoverableJob,
    viewDatasetInTable,
    resetToDashboard,
    updateRecordCell,
    deleteRecord,
    applyDatasetEdit,
    saveCurrentAsRecipe,
    loadRecipe,
    loadSchema,
  };
}

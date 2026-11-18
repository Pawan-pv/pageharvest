import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_STEP_CIRCUIT_BREAKER,
  ExtractionStateMachine,
  InvalidStateTransitionError,
  canTransition,
} from '@/core/state/extraction-machine';
import { ExtractionJob, JobStatus, JobStatusSchema, TERMINAL_JOB_STATUSES } from '@/shared/contracts/job';
import { ExtractionJobEvent } from '@/types';

/**
 * Model-based and property-based checks of the job lifecycle machine.
 *
 * The reference below is written from the lifecycle described in the job contract
 * (src/shared/contracts/job.ts) and ARCHITECTURE.md, as rules, not as a copy of the
 * production transition table. Every random event sequence is replayed against both,
 * and the two must agree on every step: which events are accepted, the resulting
 * state, and the counters.
 *
 * Seeds are fixed so a failure reproduces exactly. Set PH_PROPERTY_SEED to explore
 * other sequences; fast-check prints the seed and the shrunk counterexample on failure.
 */
const SEED = Number(process.env.PH_PROPERTY_SEED ?? 20261118);
const RUNS = Number(process.env.PH_PROPERTY_RUNS ?? 400);

const STATUSES = JobStatusSchema.options;
const ENDED: ReadonlySet<JobStatus> = new Set(TERMINAL_JOB_STATUSES);
const EXECUTING: ReadonlySet<JobStatus> = new Set<JobStatus>(['RUNNING', 'PAUSED']);

type EventType = ExtractionJobEvent['type'];
const EVENT_TYPES: readonly EventType[] = [
  'START_EXTRACTION',
  'RECORDS_EXTRACTED',
  'START_PAGINATION',
  'PAGINATION_COMPLETE',
  'PAUSE',
  'RESUME',
  'FINISH',
  'CANCEL',
  'FAIL',
  'INTERRUPT',
  'MARK_RECOVERABLE',
  'RECOVER',
  'EXPIRE',
];

/** The lifecycle as the contract states it. Returns undefined for an event the state refuses. */
function specNext(state: JobStatus, type: EventType): JobStatus | undefined {
  // An ended job accepts nothing: a new run is a new job.
  if (ENDED.has(state)) return undefined;
  switch (type) {
    // Anything not yet ended can be cancelled or fail; committed records are kept either way.
    case 'CANCEL':
      return 'CANCELLED';
    case 'FAIL':
      return 'FAILED';
    case 'START_EXTRACTION':
      return state === 'CREATED' ? 'RUNNING' : undefined;
    // Progress belongs to an executing job. A batch in flight when the user paused still counts.
    case 'RECORDS_EXTRACTED':
    case 'START_PAGINATION':
    case 'PAGINATION_COMPLETE':
      return EXECUTING.has(state) ? state : undefined;
    case 'PAUSE':
      return state === 'RUNNING' ? 'PAUSED' : undefined;
    case 'RESUME':
      return state === 'PAUSED' ? 'RUNNING' : undefined;
    // "Stop here and keep my rows" ends an executing job as completed.
    case 'FINISH':
      return EXECUTING.has(state) ? 'COMPLETED' : undefined;
    // Losing the page only matters to a job that was executing on it.
    case 'INTERRUPT':
      return EXECUTING.has(state) ? 'INTERRUPTED' : undefined;
    case 'MARK_RECOVERABLE':
      return state === 'INTERRUPTED' ? 'RECOVERABLE' : undefined;
    case 'RECOVER':
      return state === 'RECOVERABLE' ? 'RUNNING' : undefined;
    case 'EXPIRE':
      return state === 'RECOVERABLE' ? 'EXPIRED' : undefined;
  }
}

interface SpecContext {
  state: JobStatus;
  totalExtracted: number;
  totalDuplicates: number;
  consecutiveEmptySteps: number;
}

/** Applies one event to the reference. Returns null when the event is refused. */
function specApply(context: SpecContext, event: ExtractionJobEvent): SpecContext | null {
  const next = specNext(context.state, event.type);
  if (next === undefined) return null;
  const result: SpecContext = { ...context, state: next };
  if (event.type === 'START_EXTRACTION') {
    result.totalExtracted = 0;
    result.totalDuplicates = 0;
    result.consecutiveEmptySteps = 0;
  }
  if (event.type === 'RECOVER') {
    result.consecutiveEmptySteps = 0;
  }
  if (event.type === 'RECORDS_EXTRACTED') {
    result.totalExtracted += event.count;
    result.totalDuplicates += event.duplicates;
    if (event.count > 0) {
      result.consecutiveEmptySteps = 0;
    } else if (!event.ignoreEmpty) {
      result.consecutiveEmptySteps += 1;
      // The breaker: repeated steps with nothing new end the job, keeping what it has.
      if (result.consecutiveEmptySteps >= EMPTY_STEP_CIRCUIT_BREAKER) result.state = 'COMPLETED';
    }
  }
  return result;
}

const eventArb: fc.Arbitrary<ExtractionJobEvent> = fc.oneof(
  fc.record({ type: fc.constant('START_EXTRACTION' as const), totalTargetPages: fc.option(fc.integer({ min: 1, max: 50 }), { nil: undefined }) }),
  // Empty batches are weighted up so the breaker is reached often.
  {
    arbitrary: fc.record({
      type: fc.constant('RECORDS_EXTRACTED' as const),
      count: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 40 })),
      duplicates: fc.integer({ min: 0, max: 5 }),
      ignoreEmpty: fc.option(fc.boolean(), { nil: undefined }),
    }),
    weight: 4,
  },
  fc.record({ type: fc.constant('START_PAGINATION' as const), page: fc.integer({ min: 1, max: 60 }) }),
  fc.constant({ type: 'PAGINATION_COMPLETE' as const }),
  fc.constant({ type: 'PAUSE' as const }),
  fc.constant({ type: 'RESUME' as const }),
  fc.constant({ type: 'FINISH' as const }),
  fc.constant({ type: 'CANCEL' as const }),
  fc.record({ type: fc.constant('FAIL' as const), error: fc.string({ maxLength: 12 }) }),
  fc.record({ type: fc.constant('INTERRUPT' as const), reason: fc.string({ maxLength: 12 }) }),
  fc.constant({ type: 'MARK_RECOVERABLE' as const }),
  fc.constant({ type: 'RECOVER' as const }),
  fc.constant({ type: 'EXPIRE' as const })
);

function minimalEvent(type: EventType): ExtractionJobEvent {
  switch (type) {
    case 'RECORDS_EXTRACTED':
      return { type, count: 1, duplicates: 0 };
    case 'START_PAGINATION':
      return { type, page: 2 };
    case 'FAIL':
      return { type, error: 'boom' };
    case 'INTERRUPT':
      return { type, reason: 'tab closed' };
    default:
      return { type } as ExtractionJobEvent;
  }
}

function contextOf(machine: ExtractionStateMachine): SpecContext {
  const context = machine.getContext();
  return {
    state: context.state,
    totalExtracted: context.totalExtracted,
    totalDuplicates: context.totalDuplicates,
    consecutiveEmptySteps: context.consecutiveEmptySteps,
  };
}

describe('Job lifecycle machine against an independent reference model', () => {
  it('agrees with the contract on every state and event (exhaustive matrix)', () => {
    const disagreements: string[] = [];
    for (const state of STATUSES) {
      for (const type of EVENT_TYPES) {
        const expected = specNext(state, type);
        if (canTransition(state, type) !== (expected !== undefined)) {
          disagreements.push(`${state} --${type}--> expected ${expected ?? 'refused'}`);
          continue;
        }
        const machine = new ExtractionStateMachine({ state });
        if (expected === undefined) {
          expect(() => machine.transition(minimalEvent(type))).toThrow(InvalidStateTransitionError);
          expect(machine.getState()).toBe(state);
        } else {
          machine.transition(minimalEvent(type));
          if (machine.getState() !== expected) {
            disagreements.push(`${state} --${type}--> ${machine.getState()}, expected ${expected}`);
          }
        }
      }
    }
    expect(disagreements).toEqual([]);
  });

  it('follows the reference through random event sequences, refusing exactly what it refuses', () => {
    fc.assert(
      fc.property(fc.constantFrom(...STATUSES), fc.array(eventArb, { maxLength: 60 }), (initial, events) => {
        const machine = new ExtractionStateMachine({ state: initial });
        let spec: SpecContext = contextOf(machine);

        for (const event of events) {
          const before = machine.getContext();
          const expected = specApply(spec, event);
          if (expected === null) {
            expect(() => machine.transition(event)).toThrow(InvalidStateTransitionError);
            // A refused event changes nothing at all.
            expect(machine.getContext()).toEqual(before);
            continue;
          }
          machine.transition(event);
          expect(contextOf(machine)).toEqual(expected);
          spec = expected;
        }
      }),
      { seed: SEED, numRuns: RUNS }
    );
  });

  it('never leaves an ended state, whatever arrives afterwards', () => {
    fc.assert(
      fc.property(fc.constantFrom(...TERMINAL_JOB_STATUSES), fc.array(eventArb, { maxLength: 30 }), (ended, events) => {
        const machine = new ExtractionStateMachine({ state: ended, totalExtracted: 7 });
        for (const event of events) {
          expect(() => machine.transition(event)).toThrow(InvalidStateTransitionError);
        }
        expect(machine.getState()).toBe(ended);
        expect(machine.getContext().totalExtracted).toBe(7);
      }),
      { seed: SEED + 1, numRuns: RUNS }
    );
  });

  it('never decreases the record count within one run, and counts each accepted batch once', () => {
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 80 }), (events) => {
        const machine = new ExtractionStateMachine({ state: 'CREATED' });
        machine.transition({ type: 'START_EXTRACTION' });
        let accepted = 0;
        let previous = 0;
        for (const event of events) {
          if (event.type === 'START_EXTRACTION') continue; // only CREATED starts; covered above
          try {
            machine.transition(event);
          } catch (error) {
            expect(error).toBeInstanceOf(InvalidStateTransitionError);
            continue;
          }
          if (event.type === 'RECORDS_EXTRACTED') accepted += event.count;
          const total = machine.getContext().totalExtracted;
          expect(total).toBeGreaterThanOrEqual(previous);
          previous = total;
        }
        expect(machine.getContext().totalExtracted).toBe(accepted);
      }),
      { seed: SEED + 2, numRuns: RUNS }
    );
  });

  it('rebuilds the same machine from a persisted job (the coordinator does this for every event)', () => {
    const jobArb = fc.record({
      status: fc.constantFrom(...STATUSES),
      totalExtracted: fc.nat(10_000),
      duplicatesSkipped: fc.nat(10_000),
      pagesVisited: fc.nat(200),
      consecutiveEmptySteps: fc.nat(EMPTY_STEP_CIRCUIT_BREAKER - 1),
      targetSteps: fc.option(fc.integer({ min: 1, max: 200 }), { nil: undefined }),
    });
    fc.assert(
      fc.property(jobArb, fc.array(eventArb, { maxLength: 20 }), (stored, events) => {
        const job = { ...stored, startedAt: 1 } as unknown as ExtractionJob;
        const rebuilt = ExtractionStateMachine.fromJob(job);
        expect(contextOf(rebuilt)).toEqual({
          state: stored.status,
          totalExtracted: stored.totalExtracted,
          totalDuplicates: stored.duplicatesSkipped,
          consecutiveEmptySteps: stored.consecutiveEmptySteps,
        });
        // Rebuilding between events (as the worker may restart between any two) changes nothing.
        const continuous = ExtractionStateMachine.fromJob(job);
        let restarted = ExtractionStateMachine.fromJob(job);
        for (const event of events) {
          const a = attempt(continuous, event);
          const b = attempt(restarted, event);
          expect(a).toBe(b);
          const context = restarted.getContext();
          restarted = ExtractionStateMachine.fromJob({
            ...job,
            status: context.state,
            totalExtracted: context.totalExtracted,
            duplicatesSkipped: context.totalDuplicates,
            consecutiveEmptySteps: context.consecutiveEmptySteps,
          });
          expect(contextOf(restarted)).toEqual(contextOf(continuous));
        }
      }),
      { seed: SEED + 3, numRuns: RUNS }
    );
  });
});

function attempt(machine: ExtractionStateMachine, event: ExtractionJobEvent): boolean {
  try {
    machine.transition(event);
    return true;
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidStateTransitionError);
    return false;
  }
}

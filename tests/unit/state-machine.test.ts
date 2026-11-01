import { describe, it, expect, vi } from 'vitest';
import {
  EMPTY_STEP_CIRCUIT_BREAKER,
  ExtractionStateMachine,
  InvalidStateTransitionError,
  canTransition,
} from '@/core/state/extraction-machine';
import { JobStatusSchema } from '@/shared/contracts/job';

describe('ExtractionStateMachine', () => {
  it('initializes in CREATED state', () => {
    const sm = new ExtractionStateMachine();
    expect(sm.getState()).toBe('CREATED');
    expect(sm.getContext().currentPage).toBe(1);
    expect(sm.getContext().totalExtracted).toBe(0);
  });

  it('transitions through a normal multi-page extraction lifecycle', () => {
    const sm = new ExtractionStateMachine();

    // Start extraction
    sm.transition({ type: 'START_EXTRACTION', totalTargetPages: 5 });
    expect(sm.getState()).toBe('RUNNING');
    expect(sm.getContext().targetMaxPages).toBe(5);

    // Page 1 records extracted
    sm.transition({ type: 'RECORDS_EXTRACTED', count: 10, duplicates: 0 });
    expect(sm.getContext().totalExtracted).toBe(10);
    expect(sm.getState()).toBe('RUNNING');

    // Trigger page 2: the job keeps running while the next document loads
    sm.transition({ type: 'START_PAGINATION', page: 2 });
    expect(sm.getState()).toBe('RUNNING');
    expect(sm.getContext().awaitingNavigation).toBe(true);
    expect(sm.getContext().currentPage).toBe(2);

    // Page 2 loaded
    sm.transition({ type: 'PAGINATION_COMPLETE' });
    expect(sm.getContext().awaitingNavigation).toBe(false);

    // Page 2 records extracted
    sm.transition({ type: 'RECORDS_EXTRACTED', count: 8, duplicates: 2 });
    expect(sm.getContext().totalExtracted).toBe(18);
    expect(sm.getContext().totalDuplicates).toBe(2);

    // Complete
    sm.transition({ type: 'FINISH' });
    expect(sm.getState()).toBe('COMPLETED');
    expect(sm.getContext().finishedAt).toBeDefined();
  });

  it('supports pausing and resuming', () => {
    const sm = new ExtractionStateMachine();
    sm.transition({ type: 'START_EXTRACTION' });
    expect(sm.getState()).toBe('RUNNING');

    sm.transition({ type: 'PAUSE' });
    expect(sm.getState()).toBe('PAUSED');

    sm.transition({ type: 'RESUME' });
    expect(sm.getState()).toBe('RUNNING');
  });

  it('still counts a batch that was in flight when the job paused', () => {
    const sm = new ExtractionStateMachine({ state: 'PAUSED' });

    sm.transition({ type: 'RECORDS_EXTRACTED', count: 3, duplicates: 0 });

    expect(sm.getState()).toBe('PAUSED');
    expect(sm.getContext().totalExtracted).toBe(3);
  });

  it('moves an interrupted job through recovery back to running', () => {
    const sm = new ExtractionStateMachine({ state: 'RUNNING' });

    sm.transition({ type: 'INTERRUPT', reason: 'Tab closed' });
    expect(sm.getState()).toBe('INTERRUPTED');
    expect(sm.getContext().interruptedReason).toBe('Tab closed');

    sm.transition({ type: 'MARK_RECOVERABLE' });
    expect(sm.getState()).toBe('RECOVERABLE');

    sm.transition({ type: 'RECOVER' });
    expect(sm.getState()).toBe('RUNNING');
    expect(sm.getContext().interruptedReason).toBeUndefined();
  });

  it('ends cancelled, failed and expired jobs', () => {
    const cancelled = new ExtractionStateMachine({ state: 'RUNNING' });
    cancelled.transition({ type: 'CANCEL' });
    expect(cancelled.getState()).toBe('CANCELLED');

    const failed = new ExtractionStateMachine({ state: 'RUNNING' });
    failed.transition({ type: 'FAIL', error: 'Boom' });
    expect(failed.getState()).toBe('FAILED');
    expect(failed.getContext().error).toBe('Boom');

    const expired = new ExtractionStateMachine({ state: 'RECOVERABLE' });
    expired.transition({ type: 'EXPIRE' });
    expect(expired.getState()).toBe('EXPIRED');
  });

  it('allows discarding a recoverable job', () => {
    const sm = new ExtractionStateMachine({ state: 'RECOVERABLE' });
    sm.transition({ type: 'CANCEL' });
    expect(sm.getState()).toBe('CANCELLED');
  });

  it('accepts nothing once a job has ended', () => {
    for (const state of ['COMPLETED', 'CANCELLED', 'FAILED', 'EXPIRED'] as const) {
      for (const type of ['START_EXTRACTION', 'PAUSE', 'RESUME', 'FINISH', 'CANCEL', 'RECOVER'] as const) {
        expect(canTransition(state, type)).toBe(false);
      }
      const sm = new ExtractionStateMachine({ state });
      expect(() => sm.transition({ type: 'RECORDS_EXTRACTED', count: 1, duplicates: 0 })).toThrow(
        InvalidStateTransitionError
      );
    }
  });

  it('defines transitions for every status in the contract', () => {
    for (const status of JobStatusSchema.options) {
      expect(() => new ExtractionStateMachine({ state: status }).getState()).not.toThrow();
    }
  });

  it(`triggers circuit breaker after ${EMPTY_STEP_CIRCUIT_BREAKER} consecutive 0-record extractions`, () => {
    const sm = new ExtractionStateMachine();
    sm.transition({ type: 'START_EXTRACTION' });

    sm.transition({ type: 'RECORDS_EXTRACTED', count: 0, duplicates: 0 });
    expect(sm.getState()).toBe('RUNNING');

    sm.transition({ type: 'RECORDS_EXTRACTED', count: 0, duplicates: 0 });
    expect(sm.getState()).toBe('RUNNING');

    // 3rd zero-record step trips the circuit breaker
    sm.transition({ type: 'RECORDS_EXTRACTED', count: 0, duplicates: 0 });
    expect(sm.getState()).toBe('COMPLETED');
    expect(sm.getContext().consecutiveEmptySteps).toBe(3);
    expect(sm.getContext().tripped).toBe(true);
  });

  it('resets consecutive empty steps when records are extracted', () => {
    const sm = new ExtractionStateMachine();
    sm.transition({ type: 'START_EXTRACTION' });

    sm.transition({ type: 'RECORDS_EXTRACTED', count: 0, duplicates: 0 });
    sm.transition({ type: 'RECORDS_EXTRACTED', count: 0, duplicates: 0 });
    expect(sm.getContext().consecutiveEmptySteps).toBe(2);

    sm.transition({ type: 'RECORDS_EXTRACTED', count: 5, duplicates: 0 });
    expect(sm.getContext().consecutiveEmptySteps).toBe(0);
    expect(sm.getState()).toBe('RUNNING');
  });

  it('does not trip the breaker while a resumed scroll job catches up', () => {
    const sm = new ExtractionStateMachine({ state: 'RUNNING' });

    for (let i = 0; i < EMPTY_STEP_CIRCUIT_BREAKER + 2; i++) {
      sm.transition({ type: 'RECORDS_EXTRACTED', count: 0, duplicates: 4, ignoreEmpty: true });
    }

    expect(sm.getState()).toBe('RUNNING');
    expect(sm.getContext().totalDuplicates).toBe(20);
  });

  it('throws InvalidStateTransitionError on illegal transitions', () => {
    const sm = new ExtractionStateMachine();
    expect(() => sm.transition({ type: 'PAGINATION_COMPLETE' })).toThrow(
      InvalidStateTransitionError
    );
    expect(() => sm.transition({ type: 'RESUME' })).toThrow(
      InvalidStateTransitionError
    );
  });

  it('notifies subscribers on each transition', () => {
    const sm = new ExtractionStateMachine();
    const listener = vi.fn();
    const unsubscribe = sm.subscribe(listener);

    sm.transition({ type: 'START_EXTRACTION' });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    sm.transition({ type: 'PAUSE' });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

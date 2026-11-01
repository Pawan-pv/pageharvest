import { describe, it, expect, vi } from 'vitest';
import {
  ExtractionStateMachine,
  InvalidStateTransitionError
} from '@/core/state/extraction-machine';

describe('ExtractionStateMachine', () => {
  it('initializes in IDLE state', () => {
    const sm = new ExtractionStateMachine();
    expect(sm.getState()).toBe('IDLE');
    expect(sm.getContext().currentPage).toBe(1);
    expect(sm.getContext().totalExtracted).toBe(0);
  });

  it('transitions from IDLE -> INSPECTING -> IDLE', () => {
    const sm = new ExtractionStateMachine();
    sm.transition({ type: 'START_INSPECTION' });
    expect(sm.getState()).toBe('INSPECTING');

    sm.transition({ type: 'CANCEL_INSPECTION' });
    expect(sm.getState()).toBe('IDLE');
  });

  it('transitions through normal multi-page extraction lifecycle', () => {
    const sm = new ExtractionStateMachine();

    // Start extraction
    sm.transition({ type: 'START_EXTRACTION', totalTargetPages: 5 });
    expect(sm.getState()).toBe('EXTRACTING');
    expect(sm.getContext().targetMaxPages).toBe(5);

    // Page 1 records extracted
    sm.transition({ type: 'RECORDS_EXTRACTED', count: 10, duplicates: 0 });
    expect(sm.getContext().totalExtracted).toBe(10);
    expect(sm.getState()).toBe('EXTRACTING');

    // Trigger page 2
    sm.transition({ type: 'START_PAGINATION', page: 2 });
    expect(sm.getState()).toBe('PAGINATING');
    expect(sm.getContext().currentPage).toBe(2);

    // Page 2 loaded
    sm.transition({ type: 'PAGINATION_COMPLETE' });
    expect(sm.getState()).toBe('EXTRACTING');

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
    expect(sm.getState()).toBe('EXTRACTING');

    sm.transition({ type: 'PAUSE' });
    expect(sm.getState()).toBe('PAUSED');

    sm.transition({ type: 'RESUME' });
    expect(sm.getState()).toBe('EXTRACTING');
  });

  it('triggers circuit breaker after 3 consecutive 0-record extractions', () => {
    const sm = new ExtractionStateMachine();
    sm.transition({ type: 'START_EXTRACTION' });

    sm.transition({ type: 'RECORDS_EXTRACTED', count: 0, duplicates: 0 });
    expect(sm.getState()).toBe('EXTRACTING');

    sm.transition({ type: 'RECORDS_EXTRACTED', count: 0, duplicates: 0 });
    expect(sm.getState()).toBe('EXTRACTING');

    // 3rd zero-record step trips the circuit breaker
    sm.transition({ type: 'RECORDS_EXTRACTED', count: 0, duplicates: 0 });
    expect(sm.getState()).toBe('COMPLETED');
    expect(sm.getContext().consecutiveEmptySteps).toBe(3);
  });

  it('resets consecutive empty steps when records are extracted', () => {
    const sm = new ExtractionStateMachine();
    sm.transition({ type: 'START_EXTRACTION' });

    sm.transition({ type: 'RECORDS_EXTRACTED', count: 0, duplicates: 0 });
    sm.transition({ type: 'RECORDS_EXTRACTED', count: 0, duplicates: 0 });
    expect(sm.getContext().consecutiveEmptySteps).toBe(2);

    sm.transition({ type: 'RECORDS_EXTRACTED', count: 5, duplicates: 0 });
    expect(sm.getContext().consecutiveEmptySteps).toBe(0);
    expect(sm.getState()).toBe('EXTRACTING');
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

    sm.transition({ type: 'START_INSPECTION' });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    sm.transition({ type: 'CANCEL_INSPECTION' });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

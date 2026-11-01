import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ErrorReporter } from '@/core/resilience/error-reporter';

describe('Error Reporting & Diagnostics', () => {
  let reporter: ErrorReporter;

  beforeEach(() => {
    reporter = new ErrorReporter();
  });

  it('records and formats errors with category and timestamp', () => {
    const error = reporter.report(
      'SELECTOR_NOT_FOUND',
      new Error('Element div.product-card not found'),
      {
        severity: 'WARN',
        context: { selector: 'div.product-card' }
      }
    );

    expect(error.id).toMatch(/^err_/);
    expect(error.category).toBe('SELECTOR_NOT_FOUND');
    expect(error.severity).toBe('WARN');
    expect(error.message).toBe('Element div.product-card not found');
    expect(error.context).toEqual({ selector: 'div.product-card' });
    expect(error.timestamp).toBeGreaterThan(0);
  });

  it('filters errors by category', () => {
    reporter.report('DOM_PARSING', 'Parse failed');
    reporter.report('PAGINATION_FAILED', 'Next button disabled');
    reporter.report('DOM_PARSING', 'Another parse error');

    const domErrors = reporter.getErrorsByCategory('DOM_PARSING');
    expect(domErrors.length).toBe(2);

    const pagErrors = reporter.getErrorsByCategory('PAGINATION_FAILED');
    expect(pagErrors.length).toBe(1);
  });

  it('notifies subscribers on each reported error', () => {
    const listener = vi.fn();
    const unsubscribe = reporter.subscribe(listener);

    reporter.report('STORAGE_FAILED', 'Quota exceeded');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].category).toBe('STORAGE_FAILED');

    unsubscribe();
    reporter.report('STORAGE_FAILED', 'Second error');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('clears error history', () => {
    reporter.report('UNKNOWN', 'Something went wrong');
    expect(reporter.getRecentErrors().length).toBe(1);

    reporter.clear();
    expect(reporter.getRecentErrors().length).toBe(0);
  });
});

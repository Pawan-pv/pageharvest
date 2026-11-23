import { HarvestError, ErrorCategory, ErrorSeverity } from '@/types';
import type { ExtractionErrorCode } from '@/shared/contracts/error';

/**
 * The code an error gets when whoever reports it does not know a more precise one (ADR-031).
 * A category only maps to a specific code when every error in it means that one thing:
 * pagination failures, for example, cover bad templates and pages that would not open, so
 * the navigation runner names their code itself.
 */
const DEFAULT_CODE: Record<ErrorCategory, ExtractionErrorCode> = {
  DOM_PARSING: 'UNKNOWN_ERROR',
  SELECTOR_NOT_FOUND: 'CONTAINER_NOT_FOUND',
  PAGINATION_FAILED: 'UNKNOWN_ERROR',
  STORAGE_FAILED: 'STORAGE_ERROR',
  RUNTIME_MESSAGING: 'TAB_DISCONNECTED',
  VALIDATION_FAILED: 'UNKNOWN_ERROR',
  CIRCUIT_BREAKER_TRIGGERED: 'UNKNOWN_ERROR',
  UNKNOWN: 'UNKNOWN_ERROR',
};

export function codeForCategory(category: ErrorCategory): ExtractionErrorCode {
  return DEFAULT_CODE[category];
}

export class ErrorReporter {
  private static instance: ErrorReporter;
  private errors: HarvestError[] = [];
  private maxStoredErrors = 50;
  private listeners: Set<(error: HarvestError) => void> = new Set();

  public static getInstance(): ErrorReporter {
    if (!ErrorReporter.instance) {
      ErrorReporter.instance = new ErrorReporter();
    }
    return ErrorReporter.instance;
  }

  public report(
    category: ErrorCategory,
    errorOrMessage: unknown,
    options: {
      severity?: ErrorSeverity;
      context?: Record<string, unknown>;
      /** A precise code, when the caller knows one. Defaults from the category. */
      code?: ExtractionErrorCode;
    } = {}
  ): HarvestError {
    const message =
      errorOrMessage instanceof Error
        ? errorOrMessage.message
        : String(errorOrMessage || 'Unknown error');

    const stack = errorOrMessage instanceof Error ? errorOrMessage.stack : undefined;

    const harvestError: HarvestError = {
      id: `err_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      category,
      severity: options.severity || 'ERROR',
      code: options.code ?? codeForCategory(category),
      message,
      timestamp: Date.now(),
      context: options.context,
      stack
    };

    this.errors.push(harvestError);
    if (this.errors.length > this.maxStoredErrors) {
      this.errors.shift();
    }

    this.notify(harvestError);
    return harvestError;
  }

  public getRecentErrors(): ReadonlyArray<HarvestError> {
    return [...this.errors];
  }

  public getErrorsByCategory(category: ErrorCategory): HarvestError[] {
    return this.errors.filter((e) => e.category === category);
  }

  public clear(): void {
    this.errors = [];
  }

  public subscribe(listener: (error: HarvestError) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(error: HarvestError): void {
    this.listeners.forEach((listener) => {
      try {
        listener(error);
      } catch (err) {
        console.error('Error in ErrorReporter listener:', err);
      }
    });
  }
}

export const errorReporter = ErrorReporter.getInstance();

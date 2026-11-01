import { FieldDefinition } from '@/types';
import { ExtractionInput, ExtractionJobError, ExtractionFieldConfig } from './types';
import { ExtractionField } from '@/shared/contracts';

/**
 * Validates whether a string is a syntactically valid CSS selector.
 */
export function isValidCssSelector(selector: string): boolean {
  if (!selector || typeof selector !== 'string' || selector.trim().length === 0) {
    return false;
  }
  const trimmed = selector.trim();
  if (trimmed === ':scope' || trimmed === '.') {
    return true;
  }

  try {
    const dummy = document.createElement('div');
    dummy.querySelector(trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates extraction input configuration and returns collected diagnostic errors.
 */
export function validateExtractionInput(input: ExtractionInput): {
  isValid: boolean;
  errors: ExtractionJobError[];
} {
  const errors: ExtractionJobError[] = [];

  const containerSelector =
    input.repeatedItemSelector ||
    input.schema?.containerSelector;

  if (!containerSelector) {
    errors.push({
      code: 'MISSING_CONTAINER_SELECTOR',
      message: 'A repeating item container selector is required.',
      severity: 'FATAL',
      recoverable: false,
      timestamp: Date.now(),
    });
  } else if (!isValidCssSelector(containerSelector)) {
    errors.push({
      code: 'INVALID_CONTAINER_SELECTOR',
      message: `Container selector "${containerSelector}" is not a valid CSS selector.`,
      selector: containerSelector,
      severity: 'FATAL',
      recoverable: false,
      timestamp: Date.now(),
    });
  }

  if (input.rootSelector && !isValidCssSelector(input.rootSelector)) {
    errors.push({
      code: 'INVALID_ROOT_SELECTOR',
      message: `Root selector "${input.rootSelector}" is not a valid CSS selector.`,
      selector: input.rootSelector,
      severity: 'ERROR',
      recoverable: true,
      timestamp: Date.now(),
    });
  }

  // Validate fields if provided
  if (input.fields) {
    for (const field of input.fields) {
      if (field.selector && !isValidCssSelector(field.selector)) {
        errors.push({
          code: 'INVALID_SELECTOR',
          message: `Field "${field.name}" has an invalid CSS selector: "${field.selector}".`,
          field: field.name,
          selector: field.selector,
          severity: 'WARN',
          recoverable: true,
          timestamp: Date.now(),
        });
      }
    }
  }

  return {
    isValid: errors.every((e) => e.severity !== 'FATAL'),
    errors,
  };
}

/**
 * Validates an extracted record against schema constraints (e.g. required fields).
 */
export function validateRecord(
  record: Record<string, unknown>,
  fields: Array<ExtractionFieldConfig | FieldDefinition | ExtractionField>,
  containerIndex: number
): {
  isValid: boolean;
  errors: ExtractionJobError[];
} {
  const errors: ExtractionJobError[] = [];

  for (const field of fields) {
    const val = record[field.name];
    if (field.required) {
      if (val === null || val === undefined || val === '') {
        errors.push({
          code: 'MISSING_REQUIRED_FIELD',
          message: `Required field "${field.name}" was missing or empty in container ${containerIndex}.`,
          field: field.name,
          selector: field.selector,
          containerIndex,
          severity: 'ERROR',
          recoverable: true,
          timestamp: Date.now(),
        });
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

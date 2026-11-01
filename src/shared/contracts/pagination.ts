import { z } from 'zod';

/**
 * Pagination navigation strategies supported by PageHarvest.
 */
export const PaginationTypeSchema = z.enum([
  'none',             // Single page extraction
  'next_button',      // Follows "Next" button click or link
  'infinite_scroll',  // Smooth window/container scrolling
  'url_template',     // Parametric page increment (e.g. ?page={page})
]);

export type PaginationType = z.infer<typeof PaginationTypeSchema>;

/**
 * Stop conditions to prevent runaway pagination.
 */
export const PaginationStopConditionSchema = z.enum([
  'no_new_records',   // Stops after consecutive batches yield 0 new records
  'button_disabled',  // Stops when next button disappears or gets disabled
  'max_reached',      // Stops strictly at maxPages
]);

export type PaginationStopCondition = z.infer<typeof PaginationStopConditionSchema>;

/**
 * Canonical PaginationConfig schema.
 */
export const PaginationConfigSchema = z.object({
  type: PaginationTypeSchema.default('none'),
  nextButtonSelector: z.string().optional(),
  maxPages: z.number().int().min(1).max(500).default(20),
  delayMs: z.number().int().min(200).max(30000).default(1500),
  scrollCount: z.number().int().min(1).max(200).default(30),
  scrollDelayMs: z.number().int().min(300).max(10000).default(1500),
  urlTemplate: z.string().optional(),
  startPage: z.number().int().min(1).default(1),
  stopCondition: PaginationStopConditionSchema.default('no_new_records'),
});

export type PaginationConfig = z.infer<typeof PaginationConfigSchema>;

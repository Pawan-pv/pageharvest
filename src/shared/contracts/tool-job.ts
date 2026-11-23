import { z } from 'zod';
import type { ExtractedRecord } from '@/types';

export type { ExtractedRecord };

/**
 * The tools a multi-URL job can run. Sprint 2.1 ships the engine; the page, sitemap,
 * Shopify, email, social and image tools plug their per-URL extractors into it in
 * Sprints 2.2 and 2.3 without changing this contract.
 */
export const ToolTypeSchema = z.enum([
  'list',
  'table',
  'links',
  'page',
  'sitemap',
  'shopify',
  'email',
  'social',
  'page_text',
  'images',
]);

export type ToolType = z.infer<typeof ToolTypeSchema>;

/** Where the job's URL list came from. Kept so a job can explain itself and be retried. */
export const ToolUrlSourceSchema = z.enum(['manual_list', 'active_tab', 'dataset_column', 'sitemap']);

export type ToolUrlSource = z.infer<typeof ToolUrlSourceSchema>;

/** The shortest wait between two URLs handled by one worker (ADR-046). */
export const MIN_TOOL_DELAY_MS = 1000;

/** Two workers by default: quick enough for a few pages, gentle on a site. */
export const DEFAULT_TOOL_CONCURRENCY = 2;
export const MAX_TOOL_CONCURRENCY = 5;

export const ToolJobStatusSchema = z.enum([
  'queued',
  'running',
  'paused',
  'completed',
  'cancelled',
  'failed',
]);

export type ToolJobStatus = z.infer<typeof ToolJobStatusSchema>;

/**
 * One progress shape for every tool. `processedUrls` counts URLs that have been tried,
 * whether they produced rows or failed, so it never runs ahead of the work.
 */
export const ToolJobProgressSchema = z.object({
  processedUrls: z.number().int().min(0),
  totalUrls: z.number().int().min(0),
  rowsExtracted: z.number().int().min(0),
  failedUrls: z.number().int().min(0),
  status: ToolJobStatusSchema,
});

export type ToolJobProgress = z.infer<typeof ToolJobProgressSchema>;

/** A request to run one tool over a list of URLs. */
export const ToolJobRequestSchema = z.object({
  id: z.string().min(1),
  tool: ToolTypeSchema,
  urls: z.array(z.string().url()).min(1).max(10_000),
  source: ToolUrlSourceSchema,
  concurrency: z
    .number()
    .int()
    .min(1)
    .max(MAX_TOOL_CONCURRENCY)
    .default(DEFAULT_TOOL_CONCURRENCY),
  // Stored below the minimum by an older client, this is raised rather than refused.
  minDelayMs: z.number().int().min(MIN_TOOL_DELAY_MS).max(30_000).default(MIN_TOOL_DELAY_MS),
  datasetId: z.string().min(1).optional(),
  createdAt: z.number().int().default(() => Date.now()),
});

export type ToolJobRequest = z.infer<typeof ToolJobRequestSchema>;

/** A URL list handed from the grid to a tool workspace (chrome.storage.session). */
export const UrlHandoffSchema = z.object({
  tool: ToolTypeSchema,
  urls: z.array(z.string().url()).min(1).max(10_000),
  source: ToolUrlSourceSchema.default('dataset_column'),
  datasetId: z.string().min(1).optional(),
  column: z.string().min(1).optional(),
  createdAt: z.number().int().default(() => Date.now()),
});

export type UrlHandoff = z.infer<typeof UrlHandoffSchema>;

/** The session-storage key one tool reads its pending handoff from. */
export function urlHandoffKey(tool: ToolType): string {
  return `pageharvest:url-handoff:${tool}`;
}

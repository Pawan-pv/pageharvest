import { z } from 'zod';

/**
 * Multi-anchor selectors: a resilience ladder for every selector the extraction
 * engine applies to a page. Anchors are additive to the existing single-string
 * `selector` / `containerSelector` fields, so every previously stored recipe and
 * schema keeps parsing untouched: a legacy string normalizes into an anchor with
 * only its `primary` tier filled in (see normalizeSelectorAnchor).
 *
 * Tier 1 `primary`       Semantic or otherwise most-stable selector.
 * Tier 2 `fallbackClass` Filtered class selector (utility/state/hashed tokens removed).
 * Tier 3 `structuralPath` Relative DOM path from the repeating container root,
 *                        built from tags and :nth-of-type positions.
 * `fingerprint`           Structural fingerprint of the value element used to
 *                        heal a field when all CSS tiers miss.
 */

export const ExpectedValueTypeSchema = z.enum(['text', 'url', 'image', 'price', 'number']);
export type ExpectedValueType = z.infer<typeof ExpectedValueTypeSchema>;

export const ElementFingerprintSchema = z.object({
  tagName: z.string().min(1),
  ariaRole: z.string().optional(),
  /** Depth below the repeating container root: a direct child is 1. */
  relativeDepth: z.number().int().min(0),
  /** 1-based position among same-tag siblings, mirroring :nth-of-type(). */
  siblingIndex: z.number().int().min(0),
  expectedValueType: ExpectedValueTypeSchema.default('text'),
  sampleLengthRange: z
    .object({
      min: z.number().int().min(0),
      max: z.number().int().min(0),
    })
    .optional(),
  commonClassTokens: z.array(z.string()).default([]),
});
export type ElementFingerprint = z.infer<typeof ElementFingerprintSchema>;

export const MultiAnchorSelectorSchema = z.object({
  primary: z.string().min(1),
  fallbackClass: z.string().optional(),
  structuralPath: z.string().optional(),
  fingerprint: ElementFingerprintSchema.optional(),
});
export type MultiAnchorSelector = z.infer<typeof MultiAnchorSelectorSchema>;

/**
 * Converts anything a stored recipe, schema or message may carry for one selector
 * slot into a MultiAnchorSelector:
 * - a legacy plain string becomes `{ primary: value }`;
 * - an already-serialized anchor is parsed and refilled with missing tiers;
 * - anything else (empty string, wrong type) yields null so callers fall back to
 *   the original string fields and at worst behave exactly like the old engine.
 */
export function normalizeSelectorAnchor(value: unknown): MultiAnchorSelector | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return MultiAnchorSelectorSchema.parse({ primary: trimmed });
  }
  if (typeof value === 'object' && value !== null) {
    const candidate = value as Record<string, unknown>;
    const primary = typeof candidate.primary === 'string' ? candidate.primary.trim() : '';
    if (!primary) return null;
    return MultiAnchorSelectorSchema.parse({
      primary,
      fallbackClass: typeof candidate.fallbackClass === 'string' ? candidate.fallbackClass : undefined,
      structuralPath: typeof candidate.structuralPath === 'string' ? candidate.structuralPath : undefined,
      fingerprint: candidate.fingerprint ?? undefined,
    });
  }
  return null;
}

/**
 * Field-level anchor as persisted on an ExtractionField. Holds the ladder plus a
 * typed summary of how a healed selector was promoted, if healing occurred.
 */
export const HealedFieldSummarySchema = z.object({
  fieldId: z.string(),
  fieldName: z.string(),
  /** Which tier ultimately produced values: 'fallback_class' | 'structural_path' | 'fingerprint'. */
  healedTier: z.enum(['fallback_class', 'structural_path', 'fingerprint']),
  /** The selector that worked, promoted to primary when it holds an 80% hit rate. */
  promotedSelector: z.string().optional(),
  /** How many containers used the healed path on the page. */
  healedCount: z.number().int().min(0),
  containerCount: z.number().int().min(0),
});
export type HealedFieldSummary = z.infer<typeof HealedFieldSummarySchema>;

/**
 * Why the fill-rate gate paused a job on a page whose selectors no longer line up.
 * Persisted on the job so the side panel can build its drift-recovery banner from
 * stored state alone, even after a service-worker restart.
 */
export const SelectorDriftSchema = z.object({
  kind: z.enum(['container', 'field']),
  /** Present only for kind 'field'. */
  fieldId: z.string().optional(),
  fieldName: z.string().optional(),
  /** Page-1 fill rate this field had (0..1). */
  baselineRate: z.number().min(0).max(1).optional(),
  /** Fill rate of the drifting batch (0..1). */
  currentRate: z.number().min(0).max(1).optional(),
  /** Containers found on page 1. */
  baselineContainerCount: z.number().int().min(0).optional(),
  /** Containers found on the drifting page after recovery was attempted. */
  recoveredContainerCount: z.number().int().min(0).optional(),
  message: z.string(),
});
export type SelectorDrift = z.infer<typeof SelectorDriftSchema>;

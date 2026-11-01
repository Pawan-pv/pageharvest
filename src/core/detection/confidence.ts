import { ConfidenceFactors, DiscoveredField } from '@/types/detection';
import { calculateTreeSimilarity } from './similarity';
import { sampleElements } from './cache';

export interface ConfidenceInput {
  items: Element[];
  parent: Element;
  discoveredFields: DiscoveredField[];
  totalSiblingCount?: number;
}

/**
 * Deterministic Confidence Scoring Algorithm
 *
 * Overall Confidence C in [0.0, 1.0] is computed as:
 * C = min(1.0, max(0.0, w_struct * S_struct + w_freq * S_freq + w_semantic * S_semantic + w_fields * S_fields + w_attr * S_attr - Penalties))
 *
 * Weights:
 * - w_struct   = 0.30 (Structural consistency across items)
 * - w_freq     = 0.20 (Repetition frequency curve)
 * - w_semantic = 0.20 (Semantic HTML tags and ARIA roles)
 * - w_fields   = 0.20 (Field pattern richness and coverage)
 * - w_attr     = 0.10 (Attribute and class uniformity)
 */
export function calculateConfidence(input: ConfidenceInput): {
  confidence: number;
  confidencePercent: number;
  factors: ConfidenceFactors;
} {
  const { items, parent, discoveredFields } = input;
  const count = items.length;

  if (count < 2) {
    const factors: ConfidenceFactors = {
      structural: 0,
      frequency: 0,
      semantic: 0,
      fieldPatterns: 0,
      attributeUniformity: 0,
      penalties: 0,
      total: 0,
    };
    return { confidence: 0, confidencePercent: 0, factors };
  }

  // 1. Structural Consistency (w = 0.30)
  // Compute average pairwise similarity on a bounded sample (up to 5 elements)
  const sampled = sampleElements(items, 5);
  let totalSim = 0;
  let comparisons = 0;
  for (let i = 0; i < sampled.length - 1; i++) {
    for (let j = i + 1; j < sampled.length; j++) {
      totalSim += calculateTreeSimilarity(sampled[i], sampled[j]);
      comparisons++;
    }
  }
  const S_struct = comparisons > 0 ? totalSim / comparisons : 0.85;

  // 2. Frequency Repetition Score (w = 0.20)
  // For count >= 3 repetition is solid; for >= 5 it is full confidence
  const S_freq = count >= 5 ? 1.0 : count >= 3 ? 0.90 : 0.75;

  // 3. Semantic Element & ARIA Score (w = 0.20)
  let semanticScore = 0.35; // base semantic score for repeated sibling items
  const repItem = items[0];
  const itemTag = repItem.tagName.toLowerCase();
  const parentTag = parent.tagName.toLowerCase();

  if (itemTag === 'tr' && (parentTag === 'tbody' || parentTag === 'table')) {
    semanticScore = 1.0;
  } else if (itemTag === 'li' && (parentTag === 'ul' || parentTag === 'ol')) {
    semanticScore = 0.95;
  } else if (itemTag === 'article') {
    semanticScore += 0.40;
  }

  if (repItem.getAttribute('role') === 'listitem' || repItem.getAttribute('role') === 'article' || repItem.getAttribute('role') === 'row') {
    semanticScore = Math.max(semanticScore, 0.90);
  }
  if (parent.getAttribute('role') === 'feed' || parent.getAttribute('role') === 'list' || parent.getAttribute('role') === 'grid' || parent.getAttribute('role') === 'table') {
    semanticScore = Math.max(semanticScore, 0.90);
  }

  const parentClass = (parent.className || '').toLowerCase();
  const itemClass = (repItem.className || '').toLowerCase();
  const hasContainerClass = /grid|list|cards|feed|results|directory|items|catalog|table|wrapper/i.test(parentClass);
  const hasItemClass = /card|item|row|entry|product|job|post|listing|cell|bundle/i.test(itemClass);

  if (hasContainerClass && hasItemClass) {
    semanticScore = Math.max(semanticScore, 0.95);
  } else if (hasContainerClass || hasItemClass) {
    semanticScore += 0.30;
  }

  const S_semantic = Math.min(1.0, semanticScore);

  // 4. Field Pattern Richness & Coverage (w = 0.20)
  let fieldVariety = 0.40;
  const typesPresent = new Set(discoveredFields.map((f) => f.type));
  if (typesPresent.has('text')) fieldVariety += 0.25;
  if (typesPresent.has('link')) fieldVariety += 0.20;
  if (typesPresent.has('image')) fieldVariety += 0.20;
  if (typesPresent.has('price') || typesPresent.has('date')) fieldVariety += 0.25;
  if (typesPresent.has('rating') || typesPresent.has('button')) fieldVariety += 0.15;

  // Table rows with multiple columns
  if (itemTag === 'tr' && discoveredFields.length >= 2) {
    fieldVariety = 1.0;
  }
  if (typesPresent.has('price') && (typesPresent.has('text') || typesPresent.has('link'))) {
    fieldVariety = Math.max(fieldVariety, 0.95);
  }

  const avgCoverage =
    discoveredFields.length > 0
      ? discoveredFields.reduce((acc, f) => acc + (f.coverage || 1), 0) / discoveredFields.length
      : 0.6;

  const S_fields = Math.min(1.0, fieldVariety * avgCoverage);

  // 5. Attribute and Class Uniformity (w = 0.10)
  let attrScore = 0.70; // baseline for structurally grouped elements
  const repClasses = new Set(Array.from(repItem.classList));
  if (repClasses.size > 0) {
    let matchingClassCount = 0;
    for (const item of sampled) {
      for (const cls of repClasses) {
        if (item.classList.contains(cls)) matchingClassCount++;
      }
    }
    const classRatio = matchingClassCount / (sampled.length * repClasses.size);
    attrScore = Math.max(attrScore, classRatio);
  }
  const repDataAttrs = Array.from(repItem.attributes).filter((a) => a.name.startsWith('data-'));
  if (repDataAttrs.length > 0) {
    attrScore = Math.min(1.0, attrScore + 0.15);
  }
  const S_attr = Math.min(1.0, attrScore);

  // 6. Penalties
  let penalties = 0;
  const totalSiblings = input.totalSiblingCount ?? parent.children.length;
  if (totalSiblings > 10 && count / totalSiblings < 0.15) {
    penalties += 0.15;
  }
  const sampleTextLen = sampled.reduce((acc, el) => acc + (el.textContent || '').trim().length, 0);
  if (sampleTextLen < 5) {
    penalties += 0.30;
  }

  const rawTotal =
    0.30 * S_struct +
    0.20 * S_freq +
    0.20 * S_semantic +
    0.20 * S_fields +
    0.10 * S_attr -
    penalties;

  const confidence = Math.min(1.0, Math.max(0.0, Math.round(rawTotal * 100) / 100));
  const confidencePercent = Math.round(confidence * 100);

  const factors: ConfidenceFactors = {
    structural: Math.round(S_struct * 100) / 100,
    frequency: Math.round(S_freq * 100) / 100,
    semantic: Math.round(S_semantic * 100) / 100,
    fieldPatterns: Math.round(S_fields * 100) / 100,
    attributeUniformity: Math.round(S_attr * 100) / 100,
    penalties: Math.round(penalties * 100) / 100,
    total: confidence,
  };

  return { confidence, confidencePercent, factors };
}

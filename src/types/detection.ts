import { FieldExtractorType } from './field';

export type DiscoveredFieldType =
  | 'text'
  | 'link'
  | 'image'
  | 'price'
  | 'rating'
  | 'date'
  | 'button'
  | 'metadata';

export interface ConfidenceFactors {
  structural: number;
  frequency: number;
  semantic: number;
  fieldPatterns: number;
  attributeUniformity: number;
  penalties: number;
  total: number;
}

export interface CandidateSample {
  tag: string;
  previewText: string;
  classes: string[];
  attributes?: Record<string, string>;
}

export interface DiscoveredField {
  id: string;
  name: string;
  selector: string;
  extractor: FieldExtractorType;
  attributeName?: string;
  regexPattern?: string;
  regexGroup?: number;
  sampleValue: string;
  type: DiscoveredFieldType;
  confidence: number;
  occurrences: number;
  coverage: number;
  required?: boolean;
}

export interface DetectedFieldSuggestion {
  name: string;
  selector: string;
  extractor: FieldExtractorType;
  attributeName?: string;
  sampleValue: string;
  type?: DiscoveredFieldType;
  confidence?: number;
  coverage?: number;
}

export interface RepeatedPatternCandidate {
  containerSelector: string;
  count: number;
  sampleElements: CandidateSample[];
  confidence?: number;
  confidenceFactors?: ConfidenceFactors;
  discoveredFields?: DiscoveredField[];
  name?: string;
}

export interface DetectedListResult {
  name: string;
  containerSelector: string;
  parentSelector: string;
  itemSelector: string;
  itemCount: number;
  confidence: number; // 0.0 to 1.0
  confidencePercent: number; // 0 to 100
  confidenceFactors: ConfidenceFactors;
  availableFields: DiscoveredField[];
  sampleElements: CandidateSample[];
  matchedElements: Element[];
}

export interface FieldPatternHeuristic {
  name: string;
  type: DiscoveredFieldType;
  extractor: FieldExtractorType;
  selectors: string[];
  textRegex?: RegExp;
  attributeName?: string;
  weight: number;
}

export interface FieldHeuristicConfig {
  titles?: string[];
  links?: string[];
  images?: string[];
  prices?: RegExp;
  ratings?: RegExp;
  dates?: RegExp;
  buttons?: string[];
  customRules?: FieldPatternHeuristic[];
}

export interface DetectionOptions {
  maxDepth?: number;
  minItems?: number;
  minConfidence?: number;
  sampleLimit?: number;
  heuristics?: FieldHeuristicConfig;
  boundedScanLimit?: number;
}

export type FieldExtractorType =
  | 'text'
  | 'attribute'
  | 'href'
  | 'src'
  | 'html'
  | 'number'
  | 'regex'
  | 'table_cell'
  | 'link_text';

export interface FieldDefinition {
  id: string;
  name: string;
  selector: string;
  extractor: FieldExtractorType;
  attributeName?: string;
  regexPattern?: string;
  regexGroup?: number;
  defaultValue?: string;
  required?: boolean;
  transform?: 'none' | 'trim' | 'lowercase' | 'uppercase' | 'capitalize';
  columnIndex?: number;
  /** Multi-tier fallback ladder + element fingerprint for self-healing. */
  anchor?: import('@/shared/contracts/selector').MultiAnchorSelector;
  discovery?: {
    coverage: number;
    confidence: number;
    sampleSize: number;
    occurrences: number;
    suggested: boolean;
    sampleValue?: string;
  };
}

export interface DetectedFieldSuggestion {
  name: string;
  selector: string;
  extractor: FieldExtractorType;
  attributeName?: string;
  sampleValue: string;
}

export interface CandidateSample {
  tag: string;
  previewText: string;
  classes: string[];
}

export interface RepeatedPatternCandidate {
  containerSelector: string;
  count: number;
  sampleElements: CandidateSample[];
}

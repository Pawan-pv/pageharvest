export interface TruthField {
  name: string;
  kind: 'text' | 'number' | 'url' | 'srcset';
  numberFormat?: 'us' | 'eu' | 'plain';
}

export interface FieldScore {
  column: string | null;
  accuracy: number;
  completeness: number;
}

export interface SiteMetrics {
  truthCount: number;
  rowCount: number;
  precision: number;
  recall: number;
  fieldAccuracy: number;
  fieldCompleteness: number;
  duplicateRate: number;
  pageCoverage: number;
  perField: Record<string, FieldScore>;
}

export interface MetricsInput {
  truthRecords: Array<Record<string, unknown>>;
  rows: Array<Record<string, unknown>>;
  key: string;
  fields: TruthField[];
  pagesVisited: number;
  expectedPages: number;
}

export function normalizeForComparison(value: unknown, field: TruthField): string | number | null;
export function computeMetrics(input: MetricsInput): SiteMetrics;
export function summarizeResults(results: Array<{ id: string; status: string; metrics?: Partial<SiteMetrics> }>): {
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  mean: Record<string, number>;
};

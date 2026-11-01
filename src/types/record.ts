export interface ExtractedRecord {
  _id: string;
  _page: number;
  _extractedAt: number;
  _order?: number;
  _missingFields?: string;
  [fieldName: string]: string | number | boolean | null | undefined;
}

export interface RecordEntity extends ExtractedRecord {
  datasetId?: string;
  _projectId?: string;
  _jobId?: string;
  _runId?: string;
  _sourceUrl?: string;
  _hash?: string;
}

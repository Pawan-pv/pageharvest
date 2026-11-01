export interface ExtractedRecord {
  _id: string;
  _page: number;
  _extractedAt: number;
  [fieldName: string]: string | number | null | undefined;
}

export interface RecordEntity extends ExtractedRecord {
  datasetId?: string;
  _projectId?: string;
  _jobId?: string;
  _sourceUrl?: string;
  _hash?: string;
}

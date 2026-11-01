import { JobStatus } from '@/shared/contracts/job';
import { FieldDefinition } from './field';

export interface DatasetEntity {
  id: string;
  name: string;
  url: string;
  projectId?: string;
  jobId?: string;
  recipeId?: string;
  recordsCount: number;
  fields: FieldDefinition[];
  createdAt: number;
  updatedAt: number;
}

export type Dataset = DatasetEntity;

export type ExtractionStatus = 'IDLE' | JobStatus;

export interface ExtractionRunHistory {
  id: string;
  jobId?: string;
  projectId?: string;
  datasetId: string;
  recipeId?: string;
  name?: string;
  url?: string;
  status: JobStatus;
  totalExtracted: number;
  duplicatesSkipped: number;
  pagesVisited?: number;
  scrollsCompleted?: number;
  recordsDetected?: number;
  recordsWithMissingFields?: number;
  recordsFiltered?: number;
  recordsFailed?: number;
  stopReason?: string;
  startedAt: number;
  finishedAt?: number;
  errorMessage?: string;
}

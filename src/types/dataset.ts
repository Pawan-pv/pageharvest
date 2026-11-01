import { FieldDefinition } from './field';

export interface DatasetEntity {
  id: string;
  name: string;
  url: string;
  recipeId?: string;
  recordsCount: number;
  fields: FieldDefinition[];
  createdAt: number;
  updatedAt: number;
}

export type Dataset = DatasetEntity;

export type ExtractionStatus =
  | 'IDLE'
  | 'INSPECTING'
  | 'EXTRACTING'
  | 'PAGINATING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'ERROR';

export interface ExtractionRunHistory {
  id: string;
  datasetId: string;
  recipeId?: string;
  status: ExtractionStatus;
  totalExtracted: number;
  duplicatesSkipped: number;
  startedAt: number;
  finishedAt?: number;
  errorMessage?: string;
}

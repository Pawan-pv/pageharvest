// Canonical contracts and schemas remain available from this compatibility
// entry point.  New cross-context code should import from `@/shared/contracts`.
export * from '../shared/contracts';

// The application still has a deliberately supported legacy model for the
// side-panel workspace and dataset repositories.  Keep these names mapped to
// their actual legacy shapes instead of aliasing them to the stricter Zod
// output types above.  This prevents UI/storage code from silently losing
// dataset fields such as `url`, `recordsCount`, and editable field defaults.
export type {
  FieldExtractorType,
  FieldDefinition,
  DetectedFieldSuggestion,
} from './field';
export type {
  ExtractionRecipe,
  ExtractionPaginationConfig,
} from './recipe';
export type {
  ExtractedRecord,
  RecordEntity,
} from './record';
export type {
  Dataset,
  DatasetEntity,
  ExtractionRunHistory,
  ExtractionStatus,
} from './dataset';
export type {
  UserSettings,
  ExportFormat,
  CsvDelimiter,
} from './settings';
export { DEFAULT_USER_SETTINGS } from './settings';
export type {
  ExtractionJobState,
  ExtractionJobEvent,
  ExtractionJobContext,
} from './state';
export type {
  ErrorCategory,
  ErrorSeverity,
  HarvestError,
} from './error';
export type {
  ConfidenceFactors,
  CandidateSample,
  DiscoveredField,
  DiscoveredFieldType,
  FieldHeuristicConfig,
  FieldPatternHeuristic,
  DetectionOptions,
  RepeatedPatternCandidate,
  DetectedListResult,
} from './detection';

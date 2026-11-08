export interface BenchmarkSite {
  id: string;
  permission?: string;
  commercial?: boolean;
  [key: string]: unknown;
}

export function selectBenchmarkSites<T extends BenchmarkSite>(sites: T[], requestedIds: string[]): T[];
export function validateAuthorizedBenchmarkSites<T extends BenchmarkSite>(
  sites: T[],
  requestedIds: string[],
  commercialOnly?: boolean
): T[];

import { describe, expect, it } from 'vitest';
import {
  selectBenchmarkSites,
  validateAuthorizedBenchmarkSites,
} from '@/../scripts/benchmark/site-selection.mjs';

const sites = [
  { id: 'authorized-a', url: 'https://a.example', permission: 'Permission recorded.' },
  { id: 'authorized-b', url: 'https://b.example', permission: 'Permission recorded.' },
];

describe('benchmark site selection', () => {
  it('selects requested sites in the requested order', () => {
    expect(selectBenchmarkSites(sites, ['authorized-b', 'authorized-a'])).toEqual([sites[1], sites[0]]);
  });

  it('rejects an unknown site instead of running an empty benchmark', () => {
    expect(() => selectBenchmarkSites(sites, ['missing-site'])).toThrow(/Unknown benchmark site ID: missing-site/);
  });

  it('returns the full allowlist when no site IDs are requested', () => {
    expect(selectBenchmarkSites(sites, [])).toEqual(sites);
  });

  it('requires explicit commercial authorization for commercial runs', () => {
    expect(() => validateAuthorizedBenchmarkSites(sites, ['authorized-a'], true)).toThrow(
      /is not marked as an authorized commercial site/
    );

    const commercialSite = { ...sites[0], commercial: true };
    expect(validateAuthorizedBenchmarkSites([commercialSite], ['authorized-a'], true)).toEqual([commercialSite]);
  });
});

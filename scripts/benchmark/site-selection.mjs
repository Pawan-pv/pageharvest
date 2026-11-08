/**
 * Selects benchmark entries for a bounded run. Unknown IDs are an error so a
 * mistyped manual dispatch can never look like a successful empty benchmark.
 */
export function selectBenchmarkSites(sites, requestedIds) {
  if (requestedIds.length === 0) return sites;

  const byId = new Map(sites.map((site) => [site.id, site]));
  const unknown = requestedIds.filter((id) => !byId.has(id));
  if (unknown.length > 0) {
    throw new Error(`Unknown benchmark site ID: ${unknown.join(', ')}`);
  }

  return requestedIds.map((id) => byId.get(id));
}

export function validateAuthorizedBenchmarkSites(sites, requestedIds, commercialOnly = false) {
  const selected = selectBenchmarkSites(sites, requestedIds);
  for (const site of selected) {
    if (typeof site.permission !== 'string' || site.permission.trim() === '') {
      throw new Error(`Benchmark site ${site.id} has no recorded permission.`);
    }
    if (commercialOnly && site.commercial !== true) {
      throw new Error(`Benchmark site ${site.id} is not marked as an authorized commercial site.`);
    }
  }
  return selected;
}

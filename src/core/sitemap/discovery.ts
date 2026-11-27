/**
 * Discovers sitemap URLs for a given website URL or domain.
 */
export async function discoverSitemaps(
  inputUrl: string,
  fetchFn: typeof fetch = fetch
): Promise<string[]> {
  const trimmed = inputUrl.trim();
  if (!trimmed) return [];

  let origin: string;
  try {
    const parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    origin = parsed.origin;
    // If the input was directly pointing to an XML file, return it directly
    if (parsed.pathname.endsWith('.xml') || parsed.pathname.endsWith('.xml.gz')) {
      return [parsed.href];
    }
  } catch {
    return [];
  }

  const discovered = new Set<string>();

  // 1. Check robots.txt for Sitemap: directives
  try {
    const robotsUrl = `${origin}/robots.txt`;
    const response = await fetchFn(robotsUrl);
    if (response.ok) {
      const text = await response.text();
      const lines = text.split('\n');
      for (const line of lines) {
        const match = line.match(/^\s*Sitemap:\s*(https?:\/\/\S+)/i);
        if (match && match[1]) {
          discovered.add(match[1].trim());
        }
      }
    }
  } catch {
    // Ignore robots.txt network errors and proceed to standard fallback paths
  }

  if (discovered.size > 0) {
    return Array.from(discovered);
  }

  // 2. Common fallback endpoints
  const fallbackCandidates = [
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/wp-sitemap.xml`,
  ];

  for (const candidate of fallbackCandidates) {
    try {
      const response = await fetchFn(candidate, { method: 'HEAD' });
      if (response.ok) {
        discovered.add(candidate);
        break; // Found the primary sitemap index/urlset
      }
    } catch {
      // Continue to next candidate
    }
  }

  // If HEAD checks did not succeed or weren't permitted, default to sitemap.xml
  if (discovered.size === 0) {
    discovered.add(`${origin}/sitemap.xml`);
  }

  return Array.from(discovered);
}

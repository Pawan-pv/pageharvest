import {
  UrlHandoffSchema,
  urlHandoffKey,
  type ToolType,
  type ToolUrlSource,
  type UrlHandoff,
} from '@/shared/contracts/tool-job';

/**
 * The grid hands a URL column to a tool through chrome.storage.session: short-lived,
 * never written to disk, and cleared once the tool has read it.
 */
export async function storeUrlHandoff(handoff: UrlHandoff): Promise<void> {
  const validated = UrlHandoffSchema.parse(handoff);
  await chrome.storage.session.set({ [urlHandoffKey(validated.tool)]: validated });
}

export async function readUrlHandoff(tool: ToolType): Promise<UrlHandoff | null> {
  const key = urlHandoffKey(tool);
  const stored = await chrome.storage.session.get(key);
  const parsed = UrlHandoffSchema.safeParse(stored[key]);
  return parsed.success ? parsed.data : null;
}

export async function clearUrlHandoff(tool: ToolType): Promise<void> {
  await chrome.storage.session.remove(urlHandoffKey(tool));
}

/**
 * Trims, validates and de-duplicates a URL list, keeping the order the user saw. A cell
 * that is not an absolute http(s) URL is dropped: a tool cannot open it.
 */
export function dedupeUrls(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      continue;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
    const key = parsed.href;
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(key);
  }
  return urls;
}

/** The one path from a grid column to a tool workspace: store, then open the workbench. */
export async function handOffUrls(input: {
  tool: ToolType;
  urls: string[];
  source?: ToolUrlSource;
  datasetId?: string;
  column?: string;
}): Promise<{ urls: string[] }> {
  const urls = dedupeUrls(input.urls);
  if (urls.length === 0) {
    throw new Error('There are no web addresses in this column to send.');
  }
  await storeUrlHandoff({
    tool: input.tool,
    urls,
    source: input.source ?? 'dataset_column',
    datasetId: input.datasetId,
    column: input.column,
    createdAt: Date.now(),
  });
  return { urls };
}

import type { ExtractionPaginationConfig } from '@/types';

/** The values a new job uses when a setting is left alone (the contract's defaults). */
export const PAGINATION_DEFAULTS = {
  maxPages: 20,
  delayMs: 1500,
  scrollCount: 30,
  scrollDelayMs: 1500,
  startPage: 1,
  pageIncrement: 1,
} as const;

export function formatSeconds(ms: number): string {
  const seconds = Math.round((ms / 1000) * 10) / 10;
  return `${seconds.toLocaleString('en-US')} ${seconds === 1 ? 'second' : 'seconds'}`;
}

function rowLimit(config: ExtractionPaginationConfig): string {
  return config.maxRecords ? `, stopping at ${config.maxRecords.toLocaleString('en-US')} rows` : '';
}

/** One line for what the job will do about more pages, such as "Click Next, up to 20 pages". */
export function describePagination(config: ExtractionPaginationConfig): string {
  switch (config.type) {
    case 'next_button':
      return `Click Next, up to ${config.maxPages ?? PAGINATION_DEFAULTS.maxPages} pages${rowLimit(config)}`;
    case 'infinite_scroll':
      return `Scroll, up to ${config.scrollCount ?? PAGINATION_DEFAULTS.scrollCount} times${rowLimit(config)}`;
    case 'url_template':
      return `Page numbers in the URL, up to ${config.maxPages ?? PAGINATION_DEFAULTS.maxPages} pages${rowLimit(config)}`;
    default:
      return `Just this page${rowLimit(config)}`;
  }
}

/** The limits a mode runs to, in a sentence, shown above its Advanced settings. */
export function describeLimits(config: ExtractionPaginationConfig): string {
  const rows = config.maxRecords ? ` It stops at ${config.maxRecords.toLocaleString('en-US')} rows.` : '';
  switch (config.type) {
    case 'next_button':
    case 'url_template':
      return `Up to ${config.maxPages ?? PAGINATION_DEFAULTS.maxPages} pages, waiting ${formatSeconds(
        config.delayMs ?? PAGINATION_DEFAULTS.delayMs
      )} between pages.${rows}`;
    case 'infinite_scroll':
      return `Up to ${config.scrollCount ?? PAGINATION_DEFAULTS.scrollCount} scrolls, waiting ${formatSeconds(
        config.scrollDelayMs ?? PAGINATION_DEFAULTS.scrollDelayMs
      )} between scrolls.${rows}`;
    default:
      return config.maxRecords ? `Stops at ${config.maxRecords.toLocaleString('en-US')} rows.` : 'No limit on rows.';
  }
}

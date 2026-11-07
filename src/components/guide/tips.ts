import type { GuideSectionId } from './content';

/**
 * Contextual help shown by the "?" buttons next to non-obvious controls. Each tip is one or
 * two sentences and names the guide section that explains it in full. Ids are typed keys:
 * a HelpTip can only name a tip that exists here, and content.ts re-exports this registry.
 *
 * This file stays small and is bundled with the screens that show tips; the full guide in
 * content.ts is loaded only when Help opens (the import above is type-only).
 */
export interface HelpTipCopy {
  /** Short name of the control, read as "Help: <topic>". */
  topic: string;
  text: string;
  section: GuideSectionId;
}

export const helpTips = {
  'pagination-modes': {
    topic: 'How PageHarvest finds more pages',
    text: 'Pick how this site shows more items. If you are not sure, start with "Just this page" and check the rows first.',
    section: 'pagination',
  },
  'pagination-next-button': {
    topic: 'Click a Next button',
    text: 'PageHarvest clicks the site\'s Next button, waits for the new page, and collects it. Leave the button field empty and it looks for one itself.',
    section: 'pagination',
  },
  'pagination-scroll': {
    topic: 'Scroll to load more',
    text: 'For pages that add items as you scroll down. PageHarvest scrolls, waits for new items, and stops when nothing new appears.',
    section: 'pagination',
  },
  'pagination-url': {
    topic: 'Page numbers in the URL',
    text: 'For sites whose address changes with the page, such as ?page=2. Put {page} where the number goes.',
    section: 'pagination',
  },
  'pagination-limits': {
    topic: 'Limits',
    text: 'The job stops at whichever limit it reaches first. A longer wait is gentler on the site and helps slow pages finish loading.',
    section: 'pagination',
  },
  'required-field': {
    topic: 'Required columns',
    text: 'Rows with no value in a required column are skipped and counted as excluded. Leave this off to keep every row.',
    section: 'editing-fields',
  },
  dedup: {
    topic: 'Duplicates skipped',
    text: 'When pages overlap, a row PageHarvest already saved is not saved again. Only rows that are identical in every column count as duplicates.',
    section: 'running',
  },
  'regex-extractor': {
    topic: 'Pattern (regex)',
    text: 'Keeps only the part of the text that matches a regular expression, such as SKU-(\\d+). "Part to keep" picks which bracketed part to keep.',
    section: 'editing-fields',
  },
  'attribute-extractor': {
    topic: 'Attribute',
    text: 'Reads a hidden value from the element instead of its visible text, such as data-id or aria-label.',
    section: 'editing-fields',
  },
  recovery: {
    topic: 'Interrupted extractions',
    text: 'Rows are saved as they are collected, so an interruption loses nothing already saved. Resume continues from the last saved page.',
    section: 'recovering',
  },
  'finish-vs-cancel': {
    topic: 'Finish or Cancel',
    text: 'Finish stops now and opens the rows collected so far. Cancel stops the job too, and its saved rows stay in Datasets.',
    section: 'running',
  },
} as const satisfies Record<string, HelpTipCopy>;

export type HelpTipId = keyof typeof helpTips;

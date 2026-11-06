/**
 * Contextual help shown by the "?" buttons next to non-obvious controls. Each tip is one or
 * two sentences. Ids are typed keys: a HelpTip can only name a tip that exists here, and the
 * guide in content.ts links each tip to the section that explains it in full.
 *
 * This file stays small and is bundled with the screens that show tips; the full guide is
 * loaded only when Help opens.
 */
export interface HelpTipCopy {
  /** Short name of the control, read as "Help: <topic>". */
  topic: string;
  text: string;
}

export const helpTips = {
  'pagination-modes': {
    topic: 'How PageHarvest finds more pages',
    text: 'Pick how this site shows more items. If you are not sure, start with "Just this page" and check the rows first.',
  },
  'pagination-next-button': {
    topic: 'Click a Next button',
    text: 'PageHarvest clicks the site\'s Next button, waits for the new page, and collects it. Leave the button field empty and it looks for one itself.',
  },
  'pagination-scroll': {
    topic: 'Scroll to load more',
    text: 'For pages that add items as you scroll down. PageHarvest scrolls, waits for new items, and stops when nothing new appears.',
  },
  'pagination-url': {
    topic: 'Page numbers in the URL',
    text: 'For sites whose address changes with the page, such as ?page=2. Put {page} where the number goes.',
  },
  'pagination-limits': {
    topic: 'Limits',
    text: 'The job stops at whichever limit it reaches first. A longer wait is gentler on the site and helps slow pages finish loading.',
  },
  'required-field': {
    topic: 'Required columns',
    text: 'Rows with no value in a required column are skipped and counted as excluded. Leave this off to keep every row.',
  },
  dedup: {
    topic: 'Duplicates skipped',
    text: 'When pages overlap, a row PageHarvest already saved is not saved again. Only rows that are identical in every column count as duplicates.',
  },
  'regex-extractor': {
    topic: 'Pattern (regex)',
    text: 'Keeps only the part of the text that matches a regular expression, such as SKU-(\\d+). The group number picks which bracketed part to keep.',
  },
  'attribute-extractor': {
    topic: 'Attribute',
    text: 'Reads a hidden value from the element instead of its visible text, such as data-id or aria-label.',
  },
  recovery: {
    topic: 'Interrupted extractions',
    text: 'Rows are saved as they are collected, so an interruption loses nothing already saved. Resume continues from the last saved page.',
  },
  'finish-vs-cancel': {
    topic: 'Finish or Cancel',
    text: 'Finish stops now and opens the rows collected so far. Cancel stops the job too, and its saved rows stay in Datasets.',
  },
  confidence: {
    topic: 'Confidence',
    text: 'How sure PageHarvest is that these items are data rather than menus or ads. It is a guide, not a guarantee, so check the sample rows.',
  },
} as const satisfies Record<string, HelpTipCopy>;

export type HelpTipId = keyof typeof helpTips;

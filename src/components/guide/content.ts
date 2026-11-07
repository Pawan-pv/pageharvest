/**
 * The PageHarvest guide. Everything the Help screen shows lives here, in the extension: no
 * remote content and no fetches. It is loaded only when Help opens.
 *
 * Contextual tips are part of the guide: `helpTips` is re-exported from here, and each tip
 * names the section that explains it in full, so a tip id is a typed key into this guide.
 */
export { helpTips, type HelpTipId, type HelpTipCopy } from './tips';

export type GuideSectionId =
  | 'getting-started'
  | 'picking-data'
  | 'auto-detect'
  | 'editing-fields'
  | 'pagination'
  | 'running'
  | 'recovering'
  | 'exporting'
  | 'privacy'
  | 'troubleshooting';

export type GuideBlock =
  | { kind: 'text'; text: string }
  | { kind: 'steps'; items: string[] }
  | { kind: 'list'; items: string[] }
  | { kind: 'qa'; items: { question: string; answer: string }[] }
  | { kind: 'link'; text: string; href: string; note: string };

export interface GuideSection {
  id: GuideSectionId;
  title: string;
  summary: string;
  /** Extra words people might search for. */
  keywords: string[];
  blocks: GuideBlock[];
}

export const PRACTICE_SITE_URL = 'https://books.toscrape.com/';

export const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    summary: 'Turn a list on any website into a spreadsheet in five steps.',
    keywords: ['start', 'first', 'begin', 'how', 'quick', 'practice', 'tutorial'],
    blocks: [
      { kind: 'text', text: 'PageHarvest copies repeated items from a web page, such as products, search results or articles, into rows and columns you can export.' },
      {
        kind: 'steps',
        items: [
          'Open the website with the list you want, then open PageHarvest from the toolbar.',
          'Press "Find data automatically", or "Pick items myself" and click one item on the page.',
          'Check the columns, rename them, and leave out the ones you do not need.',
          'Choose how the site shows more items, or keep "Just this page".',
          'Press Start extraction, then Export to save a CSV for Excel or Google Sheets.',
        ],
      },
      {
        kind: 'link',
        text: 'Open a practice site',
        href: PRACTICE_SITE_URL,
        note: 'A public book shop made for practising, with a product list and Next buttons. It opens in a new tab.',
      },
    ],
  },
  {
    id: 'picking-data',
    title: 'Picking data',
    summary: 'Point at one item on the page and PageHarvest finds the others like it.',
    keywords: ['pick', 'picker', 'click', 'select', 'element', 'highlight', 'manual'],
    blocks: [
      { kind: 'text', text: 'Use "Pick items myself" when automatic detection chooses the wrong list, or when you want one specific part of the page.' },
      {
        kind: 'steps',
        items: [
          'Press "Pick items myself". The page shows a highlight as you move the mouse.',
          'Click one complete item, such as a whole product card rather than only its price.',
          'PageHarvest finds similar items and shows how many it found, with sample rows.',
          'Press "Use this list" if it looks right, or "Pick on the page instead" to try again.',
        ],
      },
      { kind: 'text', text: 'Press Escape on the page to stop picking.' },
    ],
  },
  {
    id: 'auto-detect',
    title: 'Auto-detect',
    summary: 'Let PageHarvest look for repeated items and show you what it found.',
    keywords: ['automatic', 'detect', 'find', 'list', 'similar', 'items', 'table', 'links'],
    blocks: [
      { kind: 'text', text: '"Find data automatically" looks for groups of items that repeat, such as cards in a grid or rows in a list. It shows how many similar items it found and a few sample rows.' },
      { kind: 'text', text: 'Nothing is used until you press "Use this list". If the sample rows are menus or adverts instead of your data, pick the items yourself.' },
      { kind: 'text', text: 'Under "More ways to start", "Extract a table" reads an HTML table, and "Extract all links" collects the links on the page.' },
    ],
  },
  {
    id: 'editing-fields',
    title: 'Editing fields',
    summary: 'Choose, rename, reorder and change what each column collects.',
    keywords: ['column', 'field', 'rename', 'reorder', 'type', 'regex', 'pattern', 'attribute', 'required', 'number', 'link', 'image'],
    blocks: [
      { kind: 'text', text: 'Each column is one piece of information from every item. Untick a column to leave it out, and use the arrows to change the column order in the export.' },
      {
        kind: 'list',
        items: [
          'Text: the words you see.',
          'Link (URL): where a link goes, written as a full web address.',
          'Image (URL): the address of a picture.',
          'Number: a number with currency symbols and spaces removed. If a value cannot be read as a number, its cell is left empty.',
          'Attribute: a hidden value on the element, such as data-id.',
          'Pattern (regex): only the part of the text that matches a pattern. "Part to keep" chooses a bracketed group.',
        ],
      },
      { kind: 'text', text: 'Required: rows with no value in that column are skipped and counted as excluded. It is off by default, so no row is dropped unless you ask.' },
      { kind: 'text', text: 'The preview updates as you change columns. It shows each item\'s text as detection read it; each column gets its own value when the extraction runs.' },
    ],
  },
  {
    id: 'pagination',
    title: 'Pagination and infinite scroll',
    summary: 'Collect more than one page: Next buttons, scrolling feeds, or page numbers in the address.',
    keywords: ['pages', 'next', 'scroll', 'infinite', 'load more', 'url', 'template', 'page number', 'limit', 'delay', 'wait'],
    blocks: [
      {
        kind: 'list',
        items: [
          'Just this page: only the items you can see now.',
          'Click a Next button: PageHarvest clicks Next, waits for the new page and collects it. It finds the button itself unless you name one under Advanced.',
          'Scroll to load more: for pages that add items as you scroll. It stops when nothing new appears.',
          'Page numbers in the URL: for addresses such as ?page=2. Write {page} where the number goes, and check the pages it will visit.',
        ],
      },
      { kind: 'text', text: 'Under Advanced you can set the most pages or scrolls, the wait between them, and a row limit. The job stops at whichever limit comes first. A longer wait is gentler on the site.' },
    ],
  },
  {
    id: 'running',
    title: 'Running, pausing and resuming jobs',
    summary: 'Watch progress, pause, finish early or cancel. Closing the panel does not stop a job.',
    keywords: ['run', 'start', 'pause', 'resume', 'cancel', 'finish', 'stop', 'progress', 'close panel', 'background', 'duplicates', 'excluded'],
    blocks: [
      { kind: 'text', text: 'While a job runs, the panel shows the page or scroll it is on, rows saved, duplicates skipped and rows excluded. Rows are saved as they arrive.' },
      { kind: 'text', text: 'You can close the side panel. The job keeps running in the background, and the panel shows it again when you reopen it.' },
      {
        kind: 'list',
        items: [
          'Pause holds the job where it is; Resume continues it.',
          'Finish stops now and shows the rows collected so far.',
          'Cancel stops the job. Rows already saved stay in Datasets.',
        ],
      },
      { kind: 'text', text: 'Duplicates skipped: when pages overlap, a row already saved is not saved again. Only rows identical in every column count as duplicates.' },
    ],
  },
  {
    id: 'recovering',
    title: 'Recovering interrupted jobs',
    summary: 'If a tab closes or the browser restarts, resume from where the job stopped.',
    keywords: ['recover', 'interrupted', 'resume', 'discard', 'crash', 'closed', 'restart', 'lost'],
    blocks: [
      { kind: 'text', text: 'Every row is saved as soon as it is collected. If a job stops before finishing, for example because its tab was closed, a banner says where it stopped and how many rows are safe.' },
      {
        kind: 'list',
        items: [
          'Resume continues from the last saved page or scroll.',
          'Discard ends the job. Its saved rows stay in Datasets, but it can no longer be resumed.',
        ],
      },
      { kind: 'text', text: 'A scrolling job that resumes has to scroll back past the rows it already has, because feeds reload from the top. Those rows are not saved twice.' },
    ],
  },
  {
    id: 'exporting',
    title: 'Exporting',
    summary: 'Save as CSV for spreadsheets, or JSON and NDJSON for other tools.',
    keywords: ['export', 'download', 'csv', 'json', 'ndjson', 'excel', 'sheets', 'numbers', 'delimiter', 'semicolon', 'formula'],
    blocks: [
      {
        kind: 'list',
        items: [
          'CSV: opens in Excel, Numbers and Google Sheets.',
          'JSON: one file with every row, for developers and other tools.',
          'NDJSON: one row per line, for large data tools.',
        ],
      },
      {
        kind: 'qa',
        items: [
          { question: 'Excel puts everything in one column.', answer: 'Excel in some countries expects a semicolon between values. Export again with the Semicolon delimiter.' },
          { question: 'Accents or symbols look wrong in Excel.', answer: 'Keep "Mark the file as UTF-8" switched on when you export.' },
          { question: 'Long numbers such as IDs show as 1.23E+15, or lose their leading zeros.', answer: 'In Excel, use Data, From Text/CSV, and set that column to Text before loading.' },
          { question: 'Some cells start with an apostrophe.', answer: 'Cells that start like a formula, such as =, + or @, get a \' in front so a spreadsheet will not run them. Numbers are written as they are.' },
        ],
      },
    ],
  },
  {
    id: 'privacy',
    title: 'Privacy',
    summary: 'Everything PageHarvest collects stays on your computer.',
    keywords: ['privacy', 'local', 'data', 'cloud', 'account', 'upload', 'tracking', 'analytics', 'offline', 'storage', 'delete'],
    blocks: [
      { kind: 'text', text: 'PageHarvest works inside your browser. Rows, recipes and settings are stored on this computer, and nothing is sent to a server: no account, no upload, no analytics.' },
      { kind: 'text', text: 'Exports are saved by your browser to your Downloads folder. Deleting a dataset in Datasets removes its rows from this computer.' },
      { kind: 'text', text: 'PageHarvest only reads pages you open and only when you ask. It does not sign in for you or get past paywalls or CAPTCHAs.' },
    ],
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    summary: 'What to try when nothing is found, values are missing, or a site will not scroll.',
    keywords: ['problem', 'error', 'help', 'nothing', 'missing', 'empty', 'blocked', 'scroll', 'text', 'numbers', 'wrong'],
    blocks: [
      {
        kind: 'qa',
        items: [
          { question: 'Nothing was detected.', answer: 'Wait until the page has finished loading and try again. If the items still are not found, press "Pick items myself" and click one whole item. Browser pages such as settings cannot be read at all.' },
          { question: 'Some values are missing.', answer: 'A column may point at the wrong part of the item, or the value may load late. Open the column under Review fields and pick it again, or set a longer wait under Pagination, Advanced. Rows with missing values are kept unless the column is Required.' },
          { question: 'The site will not scroll, or stops loading.', answer: 'Some sites load more items only with a "Load more" button: choose "Click a Next button" instead. Otherwise set a longer wait between scrolls. If the site still stops, it may be limiting visitors; try again later.' },
          { question: 'Numbers are kept as text.', answer: 'Change the column to Number under Review fields. Number removes currency symbols and spaces; a value it cannot read as a number is left empty, so check the column after the run.' },
          { question: 'An error appeared.', answer: 'Each error says whether your data is safe and what to do next. Rows already saved stay in Datasets. "Technical details" has information to share if you report a problem.' },
        ],
      },
    ],
  },
];

function sectionText(section: GuideSection): string {
  const blocks = section.blocks.map((block) => {
    switch (block.kind) {
      case 'text':
        return block.text;
      case 'steps':
      case 'list':
        return block.items.join(' ');
      case 'qa':
        return block.items.map((item) => `${item.question} ${item.answer}`).join(' ');
      case 'link':
        return `${block.text} ${block.note}`;
    }
  });
  return [section.title, section.summary, ...section.keywords, ...blocks].join(' ').toLowerCase();
}

/** Sections containing every word of the query, in guide order. An empty query matches all. */
export function searchGuide(query: string, sections: GuideSection[] = GUIDE_SECTIONS): GuideSection[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return sections;
  return sections.filter((section) => {
    const text = sectionText(section);
    return words.every((word) => text.includes(word));
  });
}

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

import { PRACTICE_SITE_URL } from './links';

export { PRACTICE_SITE_URL, PRIVACY_POLICY_URL, THIRD_PARTY_NOTICES_PATH } from './links';

export const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    summary: 'Turn a list on a website into a spreadsheet in five steps.',
    keywords: ['start', 'first', 'begin', 'how', 'quick', 'practice', 'tutorial'],
    blocks: [
      { kind: 'text', text: 'PageHarvest copies repeated items from a web page, such as products, search results or articles, into rows and columns you can export.' },
      {
        kind: 'steps',
        items: [
          'Open the website with the list you want, then open PageHarvest from the toolbar.',
          'Press "Get the list on this page". PageHarvest says how many items it found and shows the first rows.',
          'Press "Yes, this is my list", then untick the columns you do not need.',
          'Say whether the list continues on more pages, then press "Start collecting".',
          'Press "Download for Excel". The file goes to your Downloads folder.',
        ],
      },
      { kind: 'text', text: 'Advanced options, a switch in Settings, adds the detailed controls: what each column collects, page limits and waiting times, page numbers in the address, saved setups, cleaning tools and more file types. With it on, some buttons have other names; this guide gives both.' },
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
    title: 'Picking an item yourself',
    summary: 'Click one item on the page and PageHarvest finds the others like it.',
    keywords: ['pick', 'picker', 'click', 'select', 'element', 'highlight', 'manual'],
    blocks: [
      { kind: 'text', text: 'Use "Pick one item myself" when PageHarvest finds the wrong list, or when you want one particular part of the page. With Advanced options on, the button is "Pick items myself".' },
      {
        kind: 'steps',
        items: [
          'Press "Pick one item myself". The page shows a highlight as you move the mouse.',
          'Click one complete item, such as a whole product card rather than only its price.',
          'PageHarvest finds the items like it and shows how many there are, with the first rows.',
          'Press "Yes, this is my list" if it looks right, or "Not the right list?" to see the other lists on the page.',
        ],
      },
      { kind: 'text', text: 'Press Escape on the page to stop picking.' },
    ],
  },
  {
    id: 'auto-detect',
    title: 'How PageHarvest finds a list',
    summary: 'It looks for items that repeat, and shows you what it found before anything is saved.',
    keywords: ['automatic', 'detect', 'find', 'list', 'similar', 'items', 'table', 'links', 'confidence', 'candidates', 'best match'],
    blocks: [
      { kind: 'text', text: '"Get the list on this page" looks for groups of items that repeat, such as cards in a grid or rows in a list, and shows the one that most looks like data, with its first rows. Nothing is saved until you press "Start collecting".' },
      { kind: 'text', text: 'If it shows a menu or adverts instead of your data, press "Not the right list?" to see every list on the page, or pick one item yourself. A list that looks like a menu is never chosen for you.' },
      { kind: 'text', text: 'Under "More ways to start", "Get a table" reads a table on the page, and "Get all the links" collects its links.' },
      { kind: 'text', text: 'With Advanced options on, the button is "Find data automatically", and every list is shown best match first with a confidence label. Confidence says how sure PageHarvest is that a list is data rather than a menu. It is a guide, not a guarantee: check the sample rows.' },
    ],
  },
  {
    id: 'editing-fields',
    title: 'Columns',
    summary: 'Keep, leave out and rename columns. Advanced options adds what each one collects.',
    keywords: ['column', 'field', 'rename', 'reorder', 'type', 'regex', 'pattern', 'attribute', 'required', 'number', 'link', 'image'],
    blocks: [
      { kind: 'text', text: 'Each column is one piece of information from every item. Untick a column to leave it out, and type over a name to change it. Each column shows an example from the page.' },
      { kind: 'text', text: 'With Advanced options on you can also change the order with the arrows, add columns of your own, and choose what a column collects:' },
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
      { kind: 'text', text: 'Required (Advanced options): rows with no value in that column are skipped and counted as excluded. It is off by default, so no row is dropped unless you ask.' },
    ],
  },
  {
    id: 'pagination',
    title: 'More pages',
    summary: 'Collect more than one page: Next buttons, pages that grow as you scroll, or page numbers in the address.',
    keywords: ['pages', 'next', 'scroll', 'infinite', 'load more', 'url', 'template', 'page number', 'limit', 'delay', 'wait'],
    blocks: [
      { kind: 'text', text: 'PageHarvest asks one question: does this list continue on more pages? When it can see a Next or "Load more" button it suggests Yes. Choose how many pages to stop after, from 1 to 50. If items appear as you scroll down instead, choose "Yes, more items appear when I scroll down".' },
      { kind: 'text', text: 'With Advanced options on there are four ways to choose from, and higher limits:' },
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
    title: 'While it collects',
    summary: 'Watch the rows arrive, pause, or stop early and keep what you have. Closing the panel does not stop it.',
    keywords: ['run', 'start', 'pause', 'resume', 'cancel', 'finish', 'stop', 'progress', 'close panel', 'background', 'duplicates', 'excluded'],
    blocks: [
      { kind: 'text', text: 'While PageHarvest collects, the panel shows how many rows are saved and which page or scroll it is on. Rows are saved as they arrive.' },
      { kind: 'text', text: 'You can close the side panel. PageHarvest keeps working, and the panel shows the progress again when you reopen it.' },
      {
        kind: 'list',
        items: [
          'Pause holds it where it is; Continue carries on.',
          '"Stop here and keep my rows" stops now and shows the rows collected so far.',
          'With Advanced options on, the same buttons are Pause, Resume and "Finish and view rows", and Cancel stops the job and goes back to the start. Rows already saved stay in My data.',
        ],
      },
      { kind: 'text', text: 'Duplicates skipped: when pages overlap, a row already saved is not saved again. Only rows identical in every column count as duplicates.' },
    ],
  },
  {
    id: 'recovering',
    title: 'If it stops early',
    summary: 'If a tab closes or the browser restarts, continue from where it stopped.',
    keywords: ['recover', 'interrupted', 'resume', 'discard', 'crash', 'closed', 'restart', 'lost'],
    blocks: [
      { kind: 'text', text: 'Every row is saved as soon as it is collected. If collecting stops before it finishes, for example because its tab was closed, a message says so and how many rows are safe.' },
      {
        kind: 'list',
        items: [
          'Continue (Resume, with Advanced options on) carries on from the last saved page or scroll.',
          '"Stop here and keep my rows" (Discard, with Advanced options on) ends it. The saved rows stay in My data, but it can no longer be continued.',
        ],
      },
      { kind: 'text', text: 'A scrolling job that resumes has to scroll back past the rows it already has, because feeds reload from the top. Those rows are not saved twice.' },
    ],
  },
  {
    id: 'exporting',
    title: 'Exporting',
    summary: 'Save an Excel or CSV file, or copy the table. Advanced options adds JSON and NDJSON.',
    keywords: ['export', 'download', 'csv', 'json', 'ndjson', 'excel', 'sheets', 'numbers', 'delimiter', 'semicolon', 'formula'],
    blocks: [
      { kind: 'text', text: '"Download for Excel" saves an Excel file in your Downloads folder and tells you its name. "Show in folder" opens the folder with the file selected. A file is never replaced: if the name is taken, Chrome adds a number.' },
      {
        kind: 'list',
        items: [
          'Excel: opens in Excel, Numbers, LibreOffice and Google Sheets, with numbers kept as numbers.',
          'CSV: a plain text file that every spreadsheet can open.',
          'Copy the table: paste it straight into a spreadsheet.',
          'JSON and NDJSON (Advanced options): for developers and other tools.',
        ],
      },
      {
        kind: 'qa',
        items: [
          { question: 'A CSV file puts everything in one column in Excel.', answer: 'Excel in some countries expects a semicolon between values. Use "Download for Excel" instead, or with Advanced options on, export the CSV with the Semicolon delimiter.' },
          { question: 'Accents or symbols look wrong in a CSV file.', answer: 'Use "Download for Excel" instead, or with Advanced options on, keep "Mark the file as UTF-8" switched on when you export.' },
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
      { kind: 'text', text: 'PageHarvest works inside your browser. Your rows and settings are stored on this computer, and nothing is sent to a server: no account, no upload, no analytics.' },
      { kind: 'text', text: 'Files are saved by your browser to your Downloads folder. Deleting a saved list in My data removes its rows from this computer, and Settings can delete everything at once.' },
      { kind: 'text', text: 'PageHarvest reads a page only when you ask it to, and does not change anything on a site. It does not sign in for you or get past paywalls or CAPTCHAs. You are responsible for following the rules of the sites you collect from.' },
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
          { question: 'No list was found.', answer: 'Wait until the page has finished loading and try again. If the items still are not found, press "Pick one item myself" and click one whole item. Browser pages such as settings cannot be read at all.' },
          { question: 'Some values are missing.', answer: 'The value may load late, or a column may point at the wrong part of the item. Rows with missing values are always kept. With Advanced options on you can open the column on the Check columns step and correct it, or set a longer wait under More pages, Advanced.' },
          { question: 'The site will not scroll, or stops loading.', answer: 'Some sites load more items only with a "Load more" button: answer "Yes, it has a Next button or page numbers" instead. If the site still stops, it may be limiting visitors; try again later, or set a longer wait with Advanced options on.' },
          { question: 'Numbers are kept as text.', answer: 'With Advanced options on, change the column to Number on the Check columns step. Number removes currency symbols and spaces; a value it cannot read as a number is left empty, so check the column after collecting.' },
          { question: 'An error appeared.', answer: 'Each error says whether your data is safe and what to do next. Rows already saved stay in My data. "Technical details" has information to share if you report a problem.' },
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

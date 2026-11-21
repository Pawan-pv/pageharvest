import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../../entrypoints/sidepanel/App';
import { SimpleListCheck, SimpleListChooser, SimplePicking } from '@/components/simple/FindList';
import type { DetectedList } from '@/hooks/useExtractionWorkflow';
import type { FieldPreviewResult, ListCandidate } from '@/shared/contracts/message';
import type { FieldDefinition } from '@/types';
import { db } from '@/storage/db';
import { installBackground } from '../../utils/job-harness';
import { booksHtml, installFakePage, MENU_ONLY_HTML } from '../../utils/fake-page';
import { usePanelMode } from '../../utils/panel-mode';

const FIELDS: FieldDefinition[] = [
  { id: 'f_title', name: 'Title', selector: 'h3 a', extractor: 'text' },
  { id: 'f_price', name: 'Price', selector: '.price', extractor: 'text' },
  { id: 'f_link', name: 'Link', selector: 'h3 a', extractor: 'href' },
];

const LIST: DetectedList = {
  containerSelector: 'ul.products > li',
  matchCount: 20,
  sampleSnippets: ['A Light in the Attic $51.77', 'Tipping the Velvet $53.74'],
};

const ROWS: FieldPreviewResult = {
  ok: true,
  matchCount: 20,
  usedFallback: false,
  rows: [
    { Title: 'A Light in the Attic', Price: '$51.77', Link: 'https://books.example/a' },
    { Title: 'Tipping the Velvet', Price: '$53.74', Link: 'https://books.example/b' },
  ],
};

const candidate = (overrides: Partial<ListCandidate>): ListCandidate => ({
  containerSelector: 'ul.products > li',
  matchCount: 20,
  sampleSnippets: ['A Light in the Attic $51.77'],
  name: 'Product cards',
  kind: 'list',
  credible: true,
  confidence: 0.91,
  evidence: ['20 similar items'],
  suggestedFields: ['Title', 'Price'],
  ...overrides,
});

function renderCheck(props: Partial<React.ComponentProps<typeof SimpleListCheck>> = {}) {
  const handlers = { onConfirm: vi.fn(), onChooseAnother: vi.fn(), onCancel: vi.fn() };
  render(
    <SimpleListCheck
      detectedList={LIST}
      columns={FIELDS}
      onPreviewFields={vi.fn().mockResolvedValue(ROWS)}
      {...handlers}
      {...props}
    />
  );
  return handlers;
}

const JARGON = /confidence|selector|candidate|technical details|extract|schema|field/i;

describe('Simple mode: "We found N items" (T1, step 2)', () => {
  it('says how many items it found, in a sentence', async () => {
    renderCheck();
    expect(await screen.findByRole('heading', { name: 'We found 20 items on this page' })).toBeInTheDocument();
  });

  it('says "1 item" for one', () => {
    renderCheck({ detectedList: { ...LIST, matchCount: 1 } });
    expect(screen.getByRole('heading', { name: 'We found 1 item on this page' })).toBeInTheDocument();
  });

  it('shows the first rows as a plain table with a column for each piece of information', async () => {
    renderCheck();
    const table = await screen.findByRole('table', { name: 'The first rows' });
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Title', 'Price', 'Link']);
    expect(await within(table).findByText('A Light in the Attic')).toBeInTheDocument();
    expect(within(table).getByText('$53.74')).toBeInTheDocument();
  });

  it('uses no technical words anywhere on the screen', async () => {
    const { container } = render(
      <SimpleListCheck
        detectedList={LIST}
        columns={FIELDS}
        onPreviewFields={vi.fn().mockResolvedValue(ROWS)}
        onConfirm={vi.fn()}
        onChooseAnother={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    await screen.findByText('A Light in the Attic');
    expect(container.textContent).not.toMatch(JARGON);
    expect(container.textContent).not.toContain('ul.products');
  });

  it('shows the items as they were read when the columns are not known yet', () => {
    renderCheck({ columns: [] });
    expect(screen.getByText('A Light in the Attic $51.77')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yes, this is my list' })).toBeEnabled();
  });

  it('falls back to the items as they were read when the page cannot answer', async () => {
    renderCheck({
      onPreviewFields: vi
        .fn()
        .mockResolvedValue({ ok: false, code: 'TAB_DISCONNECTED', message: 'The page did not answer in time.' }),
    });
    expect(await screen.findByText('A Light in the Attic $51.77')).toBeInTheDocument();
  });

  it('has one primary button, and a way out when the list is wrong', async () => {
    const handlers = renderCheck();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, this is my list' }));
    expect(handlers.onConfirm).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Not the right list?' }));
    expect(handlers.onChooseAnother).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('Simple mode: "Not the right list?"', () => {
  const MENU = candidate({
    containerSelector: 'nav li',
    matchCount: 6,
    name: 'Links',
    credible: false,
    confidence: 0.2,
    sampleSnippets: ['Home', 'About'],
    suggestedFields: ['Link'],
  });
  const BOOKS = candidate({});

  function renderChooser(props: Partial<React.ComponentProps<typeof SimpleListChooser>> = {}) {
    const handlers = { onUse: vi.fn(), onPickMyself: vi.fn(), onCancel: vi.fn() };
    render(
      <SimpleListChooser
        detectedList={{ ...LIST, candidates: [BOOKS, MENU] }}
        {...handlers}
        {...props}
      />
    );
    return handlers;
  }

  it('lists every list on the page with its size and a sample, and no scores', () => {
    const { container } = render(
      <SimpleListChooser
        detectedList={{ ...LIST, candidates: [BOOKS, MENU] }}
        onUse={vi.fn()}
        onPickMyself={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByRole('heading', { name: 'Which list do you want?' })).toBeInTheDocument();
    expect(screen.getByText('20 items')).toBeInTheDocument();
    expect(screen.getByText('6 items')).toBeInTheDocument();
    expect(screen.getByText('A Light in the Attic $51.77')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/confidence|%|selector|technical/i);
    expect(container.textContent).not.toContain('nav li');
  });

  it('warns in plain words about a list that looks like a menu', () => {
    renderChooser();
    expect(screen.getByText('This might be a menu, not your list.')).toBeInTheDocument();
  });

  it('uses the list the user chooses', async () => {
    const handlers = renderChooser();
    const buttons = screen.getAllByRole('button', { name: /^Use this list/ });
    expect(buttons).toHaveLength(2);
    await userEvent.click(buttons[1]);
    expect(handlers.onUse).toHaveBeenCalledWith(MENU);
  });

  it('offers picking an item by hand', async () => {
    const handlers = renderChooser();
    await userEvent.click(screen.getByRole('button', { name: 'Pick one item myself' }));
    expect(handlers.onPickMyself).toHaveBeenCalledTimes(1);
  });

  it('explains what to do when the page has no list at all', () => {
    renderChooser({ detectedList: { containerSelector: '', matchCount: 0, sampleSnippets: [], candidates: [] } });
    expect(screen.getByText("We couldn't find a list on this page")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pick one item myself' })).toBeInTheDocument();
  });
});

describe('Simple mode: picking one item by hand', () => {
  it('tells the user what to click, in plain words', () => {
    const { container } = render(<SimplePicking inspectedElement={null} onCancel={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Click one item on the page' })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/element|picker|pattern|inspect|detect/i);
  });

  it('shows what was clicked without the HTML tag, and can be cancelled', async () => {
    const onCancel = vi.fn();
    render(
      <SimplePicking
        inspectedElement={{ selector: 'li.product', tagName: 'LI', classList: ['product'], textSnippet: 'Sharp Objects' }}
        onCancel={onCancel}
      />
    );
    expect(screen.getByText(/Sharp Objects/)).toBeInTheDocument();
    expect(screen.queryByText('<li>')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('App in simple mode: from the start button to the list (T1)', () => {
  beforeEach(async () => {
    await db.clearAllData();
    installBackground(db);
    await usePanelMode('simple');
  });

  it('goes straight to "We found 20 items" with real columns and rows, in one click', async () => {
    installFakePage(booksHtml(20));
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: /Find Data on This Page|Get the list on this page/i }));

    expect(await screen.findByRole('heading', { name: 'We found 20 items on this page' })).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'The first rows' });
    await within(table).findByText('Book number 1');
    expect(within(table).getAllByRole('columnheader').length).toBeGreaterThanOrEqual(2);

    // The user never saw the list of candidates, a score, or a selector.
    expect(screen.queryByText(/confidence/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Is this the data you want?')).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Steps' })).toHaveTextContent('Step 1 of 4: Find the list');
  });

  it('lets the user choose another list, then comes back to the check', async () => {
    installFakePage(`${booksHtml(20)}${MENU_ONLY_HTML}`);
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: /Find Data on This Page|Get the list on this page/i }));
    await screen.findByRole('heading', { name: /^We found \d+ items? on this page$/ });

    await userEvent.click(screen.getByRole('button', { name: 'Not the right list?' }));
    expect(await screen.findByRole('heading', { name: 'Which list do you want?' })).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: /^Use this list/ })[0]);
    expect(await screen.findByRole('heading', { name: /^We found \d+ items? on this page$/ })).toBeInTheDocument();
  });

  it('does not accept a menu on its own: it asks instead', async () => {
    installFakePage(MENU_ONLY_HTML);
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: /Find Data on This Page|Get the list on this page/i }));
    await waitFor(
      () =>
        expect(
          screen.queryByRole('heading', { name: 'Which list do you want?' }) ??
            screen.queryByText(/could not find those items|couldn't find a list/i)
        ).toBeInTheDocument(),
      { timeout: 10000 }
    );
    expect(screen.queryByRole('button', { name: 'Yes, this is my list' })).not.toBeInTheDocument();
  });

  it('still shows the list of candidates with scores when Advanced options is on', async () => {
    await usePanelMode('advanced');
    installFakePage(booksHtml(20));
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Find data automatically' }));
    expect(await screen.findByRole('heading', { name: 'Is this the data you want?' })).toBeInTheDocument();
    expect(screen.getAllByText(/confidence/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('navigation', { name: 'Steps' })).toHaveTextContent('of 5');
  });
});

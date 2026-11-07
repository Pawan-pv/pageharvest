import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FieldEditorRow } from '@/components/picker/FieldEditorRow';
import { FieldSelectionPanel, type FieldSelectionPanelProps } from '@/components/picker/FieldSelectionPanel';
import { PaginationConfigPanel } from '@/components/picker/PaginationConfigPanel';
import { describePagination } from '@/components/picker/pagination-copy';
import { useExtractionWorkflow } from '@/hooks/useExtractionWorkflow';
import type { TabInfo } from '@/services/messaging';
import type { ExtractionPaginationConfig, FieldDefinition } from '@/types';
import { makeRecipe } from '../../utils/job-harness';
import { ProjectRepository } from '@/storage/repositories';

const title: FieldDefinition = { id: 'f_title', name: 'Title', selector: 'h2.title', extractor: 'text' };
const price: FieldDefinition = { id: 'f_price', name: 'Price', selector: '.price', extractor: 'number' };

function row(field: FieldDefinition, extra: Partial<React.ComponentProps<typeof FieldEditorRow>> = {}) {
  return (
    <FieldEditorRow
      field={field}
      isSelected
      onToggleSelect={vi.fn()}
      onUpdate={vi.fn()}
      onRemove={vi.fn()}
      {...extra}
    />
  );
}

describe('FieldEditorRow', () => {
  it('shows the column type in plain words and keeps the selector out of sight', () => {
    render(row(price));
    expect(screen.getByText('Number')).toBeInTheDocument();
    expect(screen.queryByText('.price')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Include Price' })).toBeChecked();
  });

  it('moves a column up and down, and disables moves past either end', async () => {
    const onMoveUp = vi.fn();
    const onMoveDown = vi.fn();
    render(row(title, { onMoveUp, onMoveDown, isFirst: true }));

    expect(screen.getByRole('button', { name: 'Move Title up' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Move Title down' }));
    expect(onMoveDown).toHaveBeenCalledTimes(1);
    expect(onMoveUp).not.toHaveBeenCalled();
  });

  it('offers every extractor type with a plain name', async () => {
    render(row(title));
    await userEvent.click(screen.getByRole('button', { name: 'Edit field Title' }));
    const type = screen.getByLabelText('What to collect');
    const labels = within(type).getAllByRole('option').map((option) => option.textContent);
    expect(labels).toEqual(
      expect.arrayContaining(['Text', 'Link (URL)', 'Image (URL)', 'Number', 'Attribute', 'Pattern (regex)'])
    );
  });

  it('asks for a pattern when the type is regex, rejects a broken one, and saves a valid one', async () => {
    const onUpdate = vi.fn();
    render(row(title, { onUpdate }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit field Title' }));
    await userEvent.selectOptions(screen.getByLabelText('What to collect'), 'regex');
    expect(screen.getByRole('button', { name: 'Help: Pattern (regex)' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Pattern'), { target: { value: 'SKU-(\\d+' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save field edits' }));
    expect(screen.getByLabelText('Pattern')).toHaveAccessibleDescription(/not a valid pattern/);
    expect(onUpdate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Pattern'), { target: { value: 'SKU-(\\d+)' } });
    fireEvent.change(screen.getByLabelText('Part to keep'), { target: { value: '1' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save field edits' }));
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ extractor: 'regex', regexPattern: 'SKU-(\\d+)', regexGroup: 1 })
    );
  });

  it('needs an attribute name for the attribute type', async () => {
    const onUpdate = vi.fn();
    render(row(title, { onUpdate }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit field Title' }));
    await userEvent.selectOptions(screen.getByLabelText('What to collect'), 'attribute');
    await userEvent.click(screen.getByRole('button', { name: 'Save field edits' }));
    expect(screen.getByLabelText('Attribute name')).toHaveAttribute('aria-invalid', 'true');
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('marks a column required, with help next to it', async () => {
    const onUpdate = vi.fn();
    render(row(title, { onUpdate }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit field Title' }));
    expect(screen.getByRole('button', { name: 'Help: Required columns' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: /Skip rows where this column is empty/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save field edits' }));
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ required: true }));
  });
});

const none: ExtractionPaginationConfig = { type: 'none' };

function panelProps(overrides: Partial<FieldSelectionPanelProps> = {}): FieldSelectionPanelProps {
  return {
    detectedList: { containerSelector: '.card', matchCount: 24, sampleSnippets: ['Alpha £3', 'Beta £4'] },
    fields: [title, price],
    selectedFieldIds: new Set(['f_title', 'f_price']),
    pagination: none,
    onToggleField: vi.fn(),
    onUpdateField: vi.fn(),
    onAddField: vi.fn(),
    onRemoveField: vi.fn(),
    onPaginationChange: vi.fn(),
    onBack: vi.fn(),
    onStartHarvest: vi.fn(),
    ...overrides,
  };
}

describe('Review fields step', () => {
  it('previews the chosen columns in order, labelled as a sample from detection', () => {
    render(<FieldSelectionPanel {...panelProps()} />);
    const preview = screen.getByRole('region', { name: 'Preview' });
    expect(within(preview).getByText('Sample from detection')).toBeInTheDocument();
    expect(within(preview).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Title', 'Price']);
    expect(within(preview).getByText('Alpha £3')).toBeInTheDocument();
  });

  it('updates the preview as columns are renamed, reordered and left out', () => {
    const { rerender } = render(<FieldSelectionPanel {...panelProps()} />);
    rerender(
      <FieldSelectionPanel
        {...panelProps({ fields: [{ ...price, name: 'Cost' }, title], selectedFieldIds: new Set(['f_price']) })}
      />
    );
    const preview = screen.getByRole('region', { name: 'Preview' });
    expect(within(preview).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Cost']);
  });

  it('moves a column through onMoveField', async () => {
    const onMoveField = vi.fn();
    render(<FieldSelectionPanel {...panelProps({ onMoveField })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Move Price up' }));
    expect(onMoveField).toHaveBeenCalledWith('f_price', -1);
  });

  it('says what pagination will do, and goes on to the Pagination step', async () => {
    const onStepChange = vi.fn();
    render(<FieldSelectionPanel {...panelProps({ onStepChange })} />);
    expect(screen.getByText('More pages: Just this page')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next: Pagination' }));
    expect(onStepChange).toHaveBeenCalledWith('pagination');
  });

  it('keeps project and recipe settings for the Pagination step', () => {
    render(<FieldSelectionPanel {...panelProps({ onSaveRecipe: vi.fn(), onSelectProject: vi.fn() })} />);
    expect(screen.queryByLabelText('Recipe Name')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Just this page' })).not.toBeInTheDocument();
  });
});

describe('Pagination step', () => {
  it('shows the modes, project and recipe, and can go back or start', async () => {
    const onStepChange = vi.fn();
    const onStartHarvest = vi.fn();
    render(
      <FieldSelectionPanel
        {...panelProps({ step: 'pagination', onStepChange, onStartHarvest, onSaveRecipe: vi.fn(), onSelectProject: vi.fn() })}
      />
    );
    expect(screen.getByRole('radio', { name: 'Just this page' })).toBeChecked();
    expect(screen.getByLabelText('Recipe Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Project')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Back to fields' }));
    expect(onStepChange).toHaveBeenCalledWith('fields');
    await userEvent.click(screen.getByRole('button', { name: /Start extraction \(2 columns\)/ }));
    expect(onStartHarvest).toHaveBeenCalled();
  });
});

describe('PaginationConfigPanel', () => {
  it('names each mode in plain words and explains it', () => {
    render(<PaginationConfigPanel config={none} onChange={vi.fn()} />);
    expect(screen.getByRole('group', { name: /How does this site show more items/ })).toBeInTheDocument();
    for (const [name, description] of [
      ['Just this page', /only the items you can see now/],
      ['Click a Next button', /Next or page-number buttons/],
      ['Scroll to load more', /add items as you scroll/],
      ['Page numbers in the URL', /\?page=2/],
    ] as const) {
      expect(screen.getByRole('radio', { name })).toHaveAccessibleDescription(description);
    }
  });

  it('keeps limits under a collapsed Advanced section with sensible defaults', async () => {
    render(<PaginationConfigPanel config={{ type: 'next_button' }} onChange={vi.fn()} />);
    expect(screen.getByText('Up to 20 pages, waiting 1.5 seconds between pages.')).toBeInTheDocument();
    const advanced = screen.getByRole('button', { name: 'Advanced' });
    expect(advanced).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Most pages')).not.toBeInTheDocument();

    await userEvent.click(advanced);
    expect(advanced).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Most pages')).toHaveValue(20);
    expect(screen.getByLabelText('Wait between pages (seconds)')).toHaveValue(1.5);
    expect(screen.getByLabelText('Stop after this many rows')).toHaveValue(null);
  });

  it('converts seconds to the stored milliseconds, and clears the row limit when emptied', async () => {
    const onChange = vi.fn();
    render(<PaginationConfigPanel config={{ type: 'next_button', maxRecords: 50 }} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Advanced' }));

    fireEvent.change(screen.getByLabelText('Wait between pages (seconds)'), { target: { value: '2.5' } });
    expect(onChange).toHaveBeenLastCalledWith({ delayMs: 2500 });

    fireEvent.change(screen.getByLabelText('Stop after this many rows'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith({ maxRecords: undefined });
    fireEvent.change(screen.getByLabelText('Stop after this many rows'), { target: { value: '100' } });
    expect(onChange).toHaveBeenLastCalledWith({ maxRecords: 100 });
  });

  it('has help for each mode that needs it', () => {
    render(<PaginationConfigPanel config={none} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Help: How PageHarvest finds more pages' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Help: Click a Next button' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Help: Scroll to load more' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Help: Page numbers in the URL' })).toBeInTheDocument();
  });
});

describe('describePagination', () => {
  it.each<[ExtractionPaginationConfig, string]>([
    [{ type: 'none' }, 'Just this page'],
    [{ type: 'next_button', maxPages: 5 }, 'Click Next, up to 5 pages'],
    [{ type: 'infinite_scroll' }, 'Scroll, up to 30 times'],
    [{ type: 'url_template', maxPages: 9, maxRecords: 200 }, 'Page numbers in the URL, up to 9 pages, stopping at 200 rows'],
  ])('describes %j', (config, text) => {
    expect(describePagination(config)).toBe(text);
  });
});

const tab: TabInfo = { id: 1, url: 'http://localhost:3000/list', title: 'List', isInjectable: true };

function ReorderProbe() {
  const workflow = useExtractionWorkflow(tab);
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      <button
        onClick={() => {
          workflow.loadSchema(
            makeRecipe({}, { fields: [{ ...title, required: false, transform: 'trim' }, { ...price, required: false, transform: 'trim' }] })
          );
          setLoaded(true);
        }}
      >
        Load
      </button>
      <button onClick={() => workflow.moveField('f_price', -1)}>Move</button>
      <output data-testid="order">{loaded ? workflow.fields.map((field) => field.name).join(',') : ''}</output>
    </>
  );
}

/**
 * loadSchema also loads projects in the background. Answer it at once and flush it inside the
 * test, so no state update lands after the test environment is torn down.
 */
async function settleBackgroundLoads() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function answerProjectsAtOnce() {
  vi.spyOn(ProjectRepository.prototype, 'getAllProjects').mockResolvedValue([]);
}

describe('useExtractionWorkflow.moveField', () => {
  afterEach(() => vi.restoreAllMocks());

  it('swaps a column with its neighbour and ignores moves past the ends', async () => {
    answerProjectsAtOnce();
    render(<ReorderProbe />);
    act(() => screen.getByRole('button', { name: 'Load' }).click());
    await settleBackgroundLoads();
    expect(screen.getByTestId('order')).toHaveTextContent('Title,Price');
    act(() => screen.getByRole('button', { name: 'Move' }).click());
    expect(screen.getByTestId('order')).toHaveTextContent('Price,Title');
    act(() => screen.getByRole('button', { name: 'Move' }).click());
    expect(screen.getByTestId('order')).toHaveTextContent('Price,Title');
  });
});

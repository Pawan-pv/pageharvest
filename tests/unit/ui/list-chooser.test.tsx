import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DetectedListPreview } from '@/components/picker/DetectedListPreview';
import { FieldEditorRow } from '@/components/picker/FieldEditorRow';
import { AddFieldModal } from '@/components/picker/AddFieldModal';
import { DetectedList } from '@/hooks/useExtractionWorkflow';
import { ListCandidate } from '@/shared/contracts/message';

const candidate = (overrides: Partial<ListCandidate>): ListCandidate => ({
  containerSelector: 'main > .result',
  matchCount: 10,
  sampleSnippets: ['Real 0', 'Real 1'],
  name: 'Product cards',
  kind: 'list',
  credible: true,
  confidence: 0.9,
  evidence: ['10 similar items', 'in the main content'],
  suggestedFields: ['Title', 'Price'],
  ...overrides,
});

const RESULTS = candidate({});
const RECOMMENDED = candidate({
  containerSelector: '.rec > .tile',
  matchCount: 24,
  sampleSnippets: ['Rec 0'],
  name: 'Tiles',
  confidence: 0.4,
  evidence: ['labelled as recommendations or promotions'],
  suggestedFields: ['Image'],
});

function preview(list: Partial<DetectedList>, onSelect = vi.fn(), onConfirm = vi.fn()) {
  render(
    <DetectedListPreview
      detectedList={{
        containerSelector: RESULTS.containerSelector,
        matchCount: RESULTS.matchCount,
        sampleSnippets: RESULTS.sampleSnippets,
        ...list,
      }}
      onSelectCandidate={onSelect}
      onConfirm={onConfirm}
      onPickAgain={vi.fn()}
      onCancel={vi.fn()}
    />
  );
  return { onSelect, onConfirm };
}

describe('choosing a list', () => {
  it('shows each candidate with its count, fields, confidence, samples and evidence', () => {
    preview({ candidates: [RESULTS, RECOMMENDED], credible: true });

    const options = screen.getAllByRole('radio');
    expect(options).toHaveLength(2);
    const second = options[1].closest('label') as HTMLElement;
    expect(second).toHaveTextContent('Tiles');
    expect(second).toHaveTextContent('24 similar items found');
    expect(second).toHaveTextContent('Low · 40% confidence');
    expect(second).toHaveTextContent('1 column: Image');
    expect(second).toHaveTextContent('Rec 0');
    // Evidence is for checking, so it sits under each card's Technical details.
    const card = second.parentElement as HTMLElement;
    expect(card).not.toHaveTextContent('labelled as recommendations or promotions');
    fireEvent.click(within(card).getByText('Technical details'));
    expect(card).toHaveTextContent('labelled as recommendations or promotions');
  });

  it('marks the list in use, and lets the user choose another', () => {
    const { onSelect } = preview({ candidates: [RESULTS, RECOMMENDED], credible: true });

    expect(screen.getAllByRole('radio')[0]).toBeChecked();

    fireEvent.click(screen.getAllByRole('radio')[1]);

    expect(onSelect).toHaveBeenCalledWith(RECOMMENDED);
  });

  it('shows no chooser when there is only one candidate', () => {
    preview({ candidates: [RESULTS], credible: true });

    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.getByText('10 similar items found')).toBeInTheDocument();
  });

  it('says plainly when nothing looks like data, and does not proceed on its own', () => {
    const navigation = candidate({ credible: false, name: 'Menu items', confidence: 0.05, evidence: ['inside navigation, a sidebar or a footer'] });
    const { onConfirm } = preview({ candidates: [navigation], credible: false, containerSelector: navigation.containerSelector });

    // Not an error, so it is a polite status rather than an alert.
    expect(screen.getByRole('status')).toHaveTextContent('No data list was found');
    const next = screen.getByRole('button', { name: 'Use this list' });
    expect(next).toBeDisabled();

    fireEvent.click(next);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('lets the user knowingly use a low-confidence list', () => {
    const navigation = candidate({ credible: false, name: 'Menu items', confidence: 0.05 });
    const { onConfirm } = preview({ candidates: [navigation], credible: false });

    fireEvent.click(screen.getByRole('button', { name: /Use this list anyway/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Use this list' }));

    expect(onConfirm).toHaveBeenCalled();
  });

  it('does not ask for confirmation for a credible list chosen by the user', () => {
    const { onConfirm } = preview({ candidates: [RESULTS, RECOMMENDED], credible: true });

    fireEvent.click(screen.getByRole('button', { name: 'Use this list' }));

    expect(onConfirm).toHaveBeenCalled();
  });
});

describe('field evidence', () => {
  const row = (discovery?: object) =>
    render(
      <FieldEditorRow
        field={{ id: 'p', name: 'Price', selector: '.p', extractor: 'number', discovery } as never}
        isSelected
        onToggleSelect={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />
    );

  it('shows how often a field was found', () => {
    row({ coverage: 0.75, confidence: 0.75, sampleSize: 4, occurrences: 3, suggested: true, sampleValue: '12.5' });

    expect(screen.getByText(/Found in 3 of 4 sampled items/)).toBeInTheDocument();
    expect(screen.getByText(/12\.5/)).toBeInTheDocument();
  });

  it('shows nothing for a field the user added', () => {
    row();

    expect(screen.queryByText(/sampled items/)).toBeNull();
  });
});

describe('regex fields can actually be configured', () => {
  it('the editor saves a pattern and group', () => {
    const onUpdate = vi.fn();
    render(
      <FieldEditorRow
        field={{ id: 'p', name: 'Code', selector: '.p', extractor: 'text' }}
        isSelected
        onToggleSelect={vi.fn()}
        onUpdate={onUpdate}
        onRemove={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit field Code' }));
    fireEvent.change(screen.getByLabelText('What to collect'), { target: { value: 'regex' } });
    fireEvent.change(screen.getByLabelText('Pattern'), { target: { value: 'SKU-(\\d+)' } });
    fireEvent.change(screen.getByLabelText('Part to keep'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save field edits' }));

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ extractor: 'regex', regexPattern: 'SKU-(\\d+)', regexGroup: 1 })
    );
  });

  it('the editor refuses a pattern that is not valid', () => {
    const onUpdate = vi.fn();
    render(
      <FieldEditorRow
        field={{ id: 'p', name: 'Code', selector: '.p', extractor: 'regex', regexPattern: 'x' }}
        isSelected
        onToggleSelect={vi.fn()}
        onUpdate={onUpdate}
        onRemove={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit field Code' }));
    fireEvent.change(screen.getByLabelText('Pattern'), { target: { value: '(' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save field edits' }));

    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Pattern')).toHaveAccessibleDescription(/not a valid/);
  });

  it('Add Column saves a pattern and group', () => {
    const onAdd = vi.fn();
    render(<AddFieldModal isOpen onClose={vi.fn()} onAdd={onAdd} />);

    fireEvent.change(screen.getByLabelText(/Column Name/), { target: { value: 'Code' } });
    fireEvent.change(screen.getByLabelText(/Relative CSS Selector/), { target: { value: '.sku' } });
    fireEvent.change(screen.getByLabelText('Extractor Type'), { target: { value: 'regex' } });
    fireEvent.change(screen.getByLabelText(/Regex Pattern/), { target: { value: 'SKU-(\\d+)' } });
    fireEvent.change(screen.getByLabelText(/Capture Group/), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Column' }));

    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ extractor: 'regex', regexPattern: 'SKU-(\\d+)', regexGroup: 1 })
    );
  });

  it('Add Column requires a pattern for a regex field', () => {
    const onAdd = vi.fn();
    render(<AddFieldModal isOpen onClose={vi.fn()} onAdd={onAdd} />);

    fireEvent.change(screen.getByLabelText(/Column Name/), { target: { value: 'Code' } });
    fireEvent.change(screen.getByLabelText(/Relative CSS Selector/), { target: { value: '.sku' } });
    fireEvent.change(screen.getByLabelText('Extractor Type'), { target: { value: 'regex' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Column' }));

    expect(onAdd).not.toHaveBeenCalled();
  });
});

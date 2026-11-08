import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FieldEditorRow } from '@/components/picker/FieldEditorRow';
import { AddFieldModal } from '@/components/picker/AddFieldModal';
import { PaginationConfigPanel } from '@/components/picker/PaginationConfigPanel';
import { FieldSelectionPanel } from '@/components/picker/FieldSelectionPanel';
import { FieldDefinition, ExtractionPaginationConfig } from '@/types';
import { DetectedList } from '@/hooks/useExtractionWorkflow';

describe('UI: Field Selection & Configuration', () => {
  const sampleField: FieldDefinition = {
    id: 'f_title',
    name: 'Product Title',
    selector: 'h2.title',
    extractor: 'text',
  };

  const sampleDetectedList: DetectedList = {
    containerSelector: 'div.product-card',
    matchCount: 20,
    sampleSnippets: ['Sample item 1', 'Sample item 2'],
  };

  const samplePagination: ExtractionPaginationConfig = {
    type: 'next_button',
    nextButtonSelector: 'a.next-page',
    maxPages: 5,
    delayMs: 1500,
  };

  describe('FieldEditorRow', () => {
    it('renders field details with badge and selector', () => {
      render(
        <FieldEditorRow
          field={sampleField}
          isSelected={true}
          onToggleSelect={vi.fn()}
          onUpdate={vi.fn()}
          onRemove={vi.fn()}
        />
      );

      expect(screen.getByText('Product Title')).toBeInTheDocument();
      // The type is shown in plain words; the selector stays out of the way.
      expect(screen.getByText('Text')).toBeInTheDocument();
      expect(screen.queryByText('h2.title')).not.toBeInTheDocument();
    });

    it('toggles selection checkbox', () => {
      const onToggle = vi.fn();
      render(
        <FieldEditorRow
          field={sampleField}
          isSelected={true}
          onToggleSelect={onToggle}
          onUpdate={vi.fn()}
          onRemove={vi.fn()}
        />
      );

      const checkbox = screen.getByRole('checkbox');
      fireEvent.click(checkbox);
      expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('enters edit mode and allows updating name and selector', () => {
      const onUpdate = vi.fn();
      render(
        <FieldEditorRow
          field={sampleField}
          isSelected={true}
          onToggleSelect={vi.fn()}
          onUpdate={onUpdate}
          onRemove={vi.fn()}
        />
      );

      const editBtn = screen.getByLabelText(/edit field Product Title/i);
      fireEvent.click(editBtn);

      expect(screen.getByText('Edit column')).toBeInTheDocument();

      const nameInput = screen.getByPlaceholderText('e.g. Price');
      fireEvent.change(nameInput, { target: { value: 'Item Name' } });

      const saveBtn = screen.getByLabelText('Save field edits');
      fireEvent.click(saveBtn);

      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Item Name',
          selector: 'h2.title',
        })
      );
    });

    it('triggers onRemove when delete button is clicked', () => {
      const onRemove = vi.fn();
      render(
        <FieldEditorRow
          field={sampleField}
          isSelected={true}
          onToggleSelect={vi.fn()}
          onUpdate={vi.fn()}
          onRemove={onRemove}
        />
      );

      const deleteBtn = screen.getByLabelText(/remove field Product Title/i);
      fireEvent.click(deleteBtn);
      expect(onRemove).toHaveBeenCalledTimes(1);
    });
  });

  describe('AddFieldModal', () => {
    it('validates empty inputs and does not submit without required values', () => {
      const onAdd = vi.fn();
      render(
        <AddFieldModal
          isOpen={true}
          onClose={vi.fn()}
          onAdd={onAdd}
        />
      );

      const submitBtn = screen.getByRole('button', { name: 'Add Column' });
      fireEvent.click(submitBtn);

      const name = screen.getByLabelText('Column name');
      expect(name).toHaveAttribute('aria-invalid', 'true');
      expect(name).toHaveAccessibleDescription('Give the column a name.');
      expect(onAdd).not.toHaveBeenCalled();
    });

    it('submits a valid custom field definition', () => {
      const onAdd = vi.fn();
      const onClose = vi.fn();

      render(
        <AddFieldModal
          isOpen={true}
          onClose={onClose}
          onAdd={onAdd}
        />
      );

      fireEvent.change(screen.getByLabelText('Column name'), {
        target: { value: 'Discount Price' },
      });
      fireEvent.change(screen.getByLabelText('CSS selector inside each item'), {
        target: { value: '.discount' },
      });

      const submitBtn = screen.getByRole('button', { name: 'Add Column' });
      fireEvent.click(submitBtn);

      expect(onAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Discount Price',
          selector: '.discount',
          extractor: 'text',
        })
      );
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('PaginationConfigPanel', () => {
    it('switches navigation strategy modes', () => {
      const onChange = vi.fn();
      render(
        <PaginationConfigPanel
          config={{ type: 'none' }}
          onChange={onChange}
        />
      );

      fireEvent.click(screen.getByRole('radio', { name: 'Click a Next button' }));
      expect(onChange).toHaveBeenCalledWith({ type: 'next_button' });

      fireEvent.click(screen.getByRole('radio', { name: 'Scroll to load more' }));
      expect(onChange).toHaveBeenCalledWith({ type: 'infinite_scroll' });
    });

    it('renders Next Button configuration inputs when active', () => {
      const onChange = vi.fn();
      render(
        <PaginationConfigPanel
          config={samplePagination}
          onChange={onChange}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
      expect(screen.getByLabelText('Next button selector (optional)')).toBeInTheDocument();
      expect(screen.getByLabelText('Most pages')).toHaveValue(5);
      expect(screen.getByLabelText('Wait between pages (seconds)')).toHaveValue(1.5);

      const selectorInput = screen.getByDisplayValue('a.next-page');
      fireEvent.change(selectorInput, { target: { value: 'button.pagination-next' } });
      expect(onChange).toHaveBeenCalledWith({ nextButtonSelector: 'button.pagination-next' });
    });
  });

  describe('FieldSelectionPanel', () => {
    it('displays summary count and disables harvest if 0 fields selected', () => {
      render(
        <FieldSelectionPanel
          detectedList={sampleDetectedList}
          fields={[sampleField]}
          selectedFieldIds={new Set()} // 0 selected
          pagination={samplePagination}
          onToggleField={vi.fn()}
          onUpdateField={vi.fn()}
          onAddField={vi.fn()}
          onRemoveField={vi.fn()}
          onPaginationChange={vi.fn()}
          onBack={vi.fn()}
          onStartHarvest={vi.fn()}
        />
      );

      expect(screen.getByText('0 of 1 columns selected')).toBeInTheDocument();
      const harvestBtn = screen.getByRole('button', { name: /start extraction/i });
      expect(harvestBtn).toBeDisabled();
      expect(screen.getByText(/select at least one column/i)).toBeInTheDocument();
    });

    it('enables harvest button and triggers onStartHarvest when valid', () => {
      const onStartHarvest = vi.fn();
      render(
        <FieldSelectionPanel
          detectedList={sampleDetectedList}
          fields={[sampleField]}
          selectedFieldIds={new Set(['f_title'])}
          pagination={samplePagination}
          onToggleField={vi.fn()}
          onUpdateField={vi.fn()}
          onAddField={vi.fn()}
          onRemoveField={vi.fn()}
          onPaginationChange={vi.fn()}
          onBack={vi.fn()}
          onStartHarvest={onStartHarvest}
        />
      );

      const harvestBtn = screen.getByRole('button', { name: /start extraction \(1 column\)/i });
      expect(harvestBtn).not.toBeDisabled();

      fireEvent.click(harvestBtn);
      expect(onStartHarvest).toHaveBeenCalledTimes(1);
    });
  });
});

describe('Add Column dialog', () => {
  it('uses the same words as the column editor, and shows the pattern example as written', () => {
    render(<AddFieldModal isOpen onClose={vi.fn()} onAdd={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Add a column' })).toBeInTheDocument();
    const type = screen.getByLabelText('What to collect');
    const options = Array.from(type.querySelectorAll('option')).map((option) => option.textContent);
    expect(options).toEqual(['Text', 'Link (URL)', 'Image (URL)', 'Number', 'Attribute', 'Pattern (regex)', 'HTML (advanced)']);
    fireEvent.change(type, { target: { value: 'regex' } });
    expect(screen.getByLabelText('Pattern')).toHaveAttribute('placeholder', String.raw`e.g. SKU-(\d+)`);
    expect(screen.getByRole('button', { name: 'Help: Pattern (regex)' })).toBeInTheDocument();
  });

  it('ties each problem to its own field', () => {
    const onAdd = vi.fn();
    render(<AddFieldModal isOpen onClose={vi.fn()} onAdd={onAdd} />);
    fireEvent.change(screen.getByLabelText('Column name'), { target: { value: 'Code' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Column' }));
    expect(screen.getByLabelText('CSS selector inside each item')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Column name')).not.toHaveAttribute('aria-invalid');

    fireEvent.change(screen.getByLabelText('CSS selector inside each item'), { target: { value: '.sku' } });
    fireEvent.change(screen.getByLabelText('What to collect'), { target: { value: 'attribute' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Column' }));
    expect(screen.getByLabelText('Attribute name')).toHaveAccessibleDescription(/Name the attribute/);
    expect(onAdd).not.toHaveBeenCalled();
  });
});

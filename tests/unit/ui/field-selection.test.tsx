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
      expect(screen.getByText('text')).toBeInTheDocument();
      expect(screen.getByText('h2.title')).toBeInTheDocument();
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

      expect(screen.getByText('Edit Column Definition')).toBeInTheDocument();

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

      expect(screen.getByText(/please provide a column name/i)).toBeInTheDocument();
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

      fireEvent.change(screen.getByPlaceholderText('e.g. Product Rating'), {
        target: { value: 'Discount Price' },
      });
      fireEvent.change(screen.getByPlaceholderText(/span.rating/i), {
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

      fireEvent.click(screen.getByText('Next Button'));
      expect(onChange).toHaveBeenCalledWith({ type: 'next_button' });

      fireEvent.click(screen.getByText('Infinite Scroll'));
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

      expect(screen.getByText('Next Button Selector')).toBeInTheDocument();
      expect(screen.getByText('Max Pages to Crawl')).toBeInTheDocument();
      expect(screen.getByText('Delay Between Pages (ms)')).toBeInTheDocument();

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

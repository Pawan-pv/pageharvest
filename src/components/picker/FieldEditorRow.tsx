import React, { useState } from 'react';
import { Edit3, Trash2, Check, X } from 'lucide-react';
import { Badge } from '@/components/common/Badge';
import { Input } from '@/components/common/Input';
import { Select } from '@/components/common/Select';
import { FieldDefinition, FieldExtractorType } from '@/types';

export interface FieldEditorRowProps {
  field: FieldDefinition;
  isSelected: boolean;
  onToggleSelect: () => void;
  onUpdate: (updates: Partial<FieldDefinition>) => void;
  onRemove: () => void;
}

export const FieldEditorRow: React.FC<FieldEditorRowProps> = ({
  field,
  isSelected,
  onToggleSelect,
  onUpdate,
  onRemove,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(field.name);
  const [editSelector, setEditSelector] = useState(field.selector);
  const [editExtractor, setEditExtractor] = useState<FieldExtractorType>(field.extractor);
  const [editAttr, setEditAttr] = useState(field.attributeName || '');
  const [editRequired, setEditRequired] = useState(field.required === true);

  const extractorOptions: { value: FieldExtractorType; label: string }[] = [
    { value: 'text', label: 'Text content' },
    { value: 'href', label: 'Link URL (href)' },
    { value: 'src', label: 'Image URL (src)' },
    { value: 'number', label: 'Number / Price' },
    { value: 'html', label: 'Raw HTML' },
    { value: 'attribute', label: 'HTML Attribute' },
    { value: 'regex', label: 'Regex Pattern' },
  ];

  const handleSave = () => {
    onUpdate({
      name: editName.trim() || field.name,
      selector: editSelector.trim() || field.selector,
      extractor: editExtractor,
      attributeName: editExtractor === 'attribute' ? editAttr.trim() : undefined,
      required: editRequired,
    });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditName(field.name);
    setEditSelector(field.selector);
    setEditExtractor(field.extractor);
    setEditAttr(field.attributeName || '');
    setEditRequired(field.required === true);
    setIsEditing(false);
  };

  const badgeVariantForExtractor: Record<FieldExtractorType, 'brand' | 'info' | 'warning' | 'neutral' | 'success' | 'danger'> = {
    text: 'neutral',
    href: 'info',
    src: 'brand',
    number: 'success',
    html: 'warning',
    attribute: 'neutral',
    regex: 'danger',
  };

  return (
    <div
      className={`p-3 rounded-xl border transition-all duration-150 text-left ${
        isSelected
          ? 'bg-surface border-line/90 shadow-xs'
          : 'bg-surface-sunken/60 border-line/60 opacity-60'
      }`}
    >
      {!isEditing ? (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <input
              type="checkbox"
              id={`field-toggle-${field.id}`}
              checked={isSelected}
              onChange={onToggleSelect}
              className="w-4 h-4 rounded border-line-strong text-brand-fg focus:ring-focus cursor-pointer"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <label
                  htmlFor={`field-toggle-${field.id}`}
                  className="text-xs font-semibold text-fg cursor-pointer hover:text-brand-fg truncate"
                >
                  {field.name}
                </label>
                <Badge variant={badgeVariantForExtractor[(field.extractor as FieldExtractorType) || 'text'] || 'neutral'} size="sm">
                  {field.extractor}
                </Badge>
                {field.required && (
                  <Badge variant="warning" size="sm">
                    filters rows
                  </Badge>
                )}
              </div>
              <div className="text-2xs text-fg-subtle font-mono truncate mt-0.5" title={field.selector}>
                {field.selector}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setIsEditing(true)}
              aria-label={`Edit field ${field.name}`}
              className="p-1 text-fg-subtle hover:text-fg-muted hover:bg-surface-muted rounded transition-colors"
            >
              <Edit3 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onRemove}
              aria-label={`Remove field ${field.name}`}
              className="p-1 text-fg-subtle hover:text-danger-fg hover:bg-danger-soft rounded transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ) : (
        /* Edit Mode */
        <div className="flex flex-col gap-2.5 pt-1">
          <div className="flex items-center justify-between border-b border-line-subtle pb-2">
            <span className="text-xs font-semibold text-fg">Edit Column Definition</span>
            <div className="flex items-center gap-1">
              <button
                onClick={handleCancel}
                aria-label="Cancel edit"
                className="p-1 text-fg-subtle hover:text-fg-muted rounded"
              >
                <X className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleSave}
                aria-label="Save field edits"
                className="p-1 text-brand-fg hover:text-brand-fg rounded bg-brand-soft"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Input
              label="Column Name"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="e.g. Price"
            />
            <Select
              label="Data Type"
              value={editExtractor}
              options={extractorOptions}
              onChange={(e) => setEditExtractor(e.target.value as FieldExtractorType)}
            />
          </div>

          <Input
            label="Relative CSS Selector"
            value={editSelector}
            onChange={(e) => setEditSelector(e.target.value)}
            placeholder="e.g. .price-value"
            helperText="Selector relative to the item container"
          />

          {editExtractor === 'attribute' && (
            <Input
              label="Attribute Name"
              value={editAttr}
              onChange={(e) => setEditAttr(e.target.value)}
              placeholder="e.g. data-asin or aria-label"
            />
          )}

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={editRequired}
              onChange={(e) => setEditRequired(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-line-strong text-brand-fg focus:ring-focus"
            />
            <span className="text-xs text-fg-muted">
              Skip rows where this column is empty
              <span className="block text-2xs text-fg-subtle">
                Off by default, so rows with a missing value are kept. Skipped rows are counted.
              </span>
            </span>
          </label>
        </div>
      )}
    </div>
  );
};

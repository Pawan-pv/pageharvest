import React, { useState } from 'react';
import { Edit3, Trash2, Check, X, Tag } from 'lucide-react';
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
    });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditName(field.name);
    setEditSelector(field.selector);
    setEditExtractor(field.extractor);
    setEditAttr(field.attributeName || '');
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
          ? 'bg-white border-slate-200/90 shadow-xs'
          : 'bg-slate-50/60 border-slate-200/60 opacity-60'
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
              className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <label
                  htmlFor={`field-toggle-${field.id}`}
                  className="text-xs font-semibold text-slate-900 cursor-pointer hover:text-emerald-700 truncate"
                >
                  {field.name}
                </label>
                <Badge variant={badgeVariantForExtractor[field.extractor]} size="sm">
                  {field.extractor}
                </Badge>
              </div>
              <div className="text-[11px] text-slate-400 font-mono truncate mt-0.5" title={field.selector}>
                {field.selector}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setIsEditing(true)}
              aria-label={`Edit field ${field.name}`}
              className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors"
            >
              <Edit3 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onRemove}
              aria-label={`Remove field ${field.name}`}
              className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ) : (
        /* Edit Mode */
        <div className="flex flex-col gap-2.5 pt-1">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <span className="text-xs font-semibold text-slate-800">Edit Column Definition</span>
            <div className="flex items-center gap-1">
              <button
                onClick={handleCancel}
                aria-label="Cancel edit"
                className="p-1 text-slate-400 hover:text-slate-600 rounded"
              >
                <X className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleSave}
                aria-label="Save field edits"
                className="p-1 text-emerald-600 hover:text-emerald-700 rounded bg-emerald-50"
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
        </div>
      )}
    </div>
  );
};

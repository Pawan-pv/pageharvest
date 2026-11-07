import React, { useId, useState } from 'react';
import { Edit3, Trash2, Check, X, ArrowUp, ArrowDown } from 'lucide-react';
import { Badge } from '@/components/common/Badge';
import { IconButton } from '@/components/common/IconButton';
import { HelpTip } from '@/components/common/Tooltip';
import { Input } from '@/components/common/Input';
import { Select } from '@/components/common/Select';
import { Disclosure } from '@/components/common/Disclosure';
import { FieldDefinition, FieldExtractorType } from '@/types';

export interface FieldEditorRowProps {
  field: FieldDefinition;
  isSelected: boolean;
  onToggleSelect: () => void;
  onUpdate: (updates: Partial<FieldDefinition>) => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
}

/** Plain names for what a column collects. */
export const EXTRACTOR_LABELS: Record<FieldExtractorType, string> = {
  text: 'Text',
  href: 'Link (URL)',
  src: 'Image (URL)',
  number: 'Number',
  attribute: 'Attribute',
  regex: 'Pattern (regex)',
  html: 'HTML (advanced)',
  table_cell: 'Table column',
  link_text: 'Link text',
};

/** The types a person can choose, in the order they are offered. */
export const EXTRACTOR_ORDER: FieldExtractorType[] = ['text', 'href', 'src', 'number', 'attribute', 'regex', 'html'];

/** Why a pattern cannot be used, or an empty string if it can. */
export function regexProblem(pattern: string): string {
  if (!pattern.trim()) return 'This type needs a pattern.';
  try {
    new RegExp(pattern);
    return '';
  } catch {
    return `"${pattern}" is not a valid pattern.`;
  }
}

export const FieldEditorRow: React.FC<FieldEditorRowProps> = ({
  field,
  isSelected,
  onToggleSelect,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
  isFirst = false,
  isLast = false,
}) => {
  const checkboxId = useId();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(field.name);
  const [editSelector, setEditSelector] = useState(field.selector);
  const [editExtractor, setEditExtractor] = useState<FieldExtractorType>(field.extractor);
  const [editAttr, setEditAttr] = useState(field.attributeName || '');
  const [editRegex, setEditRegex] = useState(field.regexPattern || '');
  const [editRegexGroup, setEditRegexGroup] = useState(String(field.regexGroup ?? 0));
  const [editRequired, setEditRequired] = useState(field.required === true);
  const [errors, setErrors] = useState<{ attribute?: string; regex?: string }>({});

  const resetEdits = () => {
    setEditName(field.name);
    setEditSelector(field.selector);
    setEditExtractor(field.extractor);
    setEditAttr(field.attributeName || '');
    setEditRegex(field.regexPattern || '');
    setEditRegexGroup(String(field.regexGroup ?? 0));
    setEditRequired(field.required === true);
    setErrors({});
  };

  const handleSave = () => {
    const nextErrors: { attribute?: string; regex?: string } = {};
    if (editExtractor === 'attribute' && !editAttr.trim()) {
      nextErrors.attribute = 'Name the attribute to read, such as data-id.';
    }
    if (editExtractor === 'regex') {
      const problem = regexProblem(editRegex);
      if (problem) nextErrors.regex = problem;
    }
    setErrors(nextErrors);
    if (nextErrors.attribute || nextErrors.regex) return;
    onUpdate({
      name: editName.trim() || field.name,
      selector: editSelector.trim() || field.selector,
      extractor: editExtractor,
      attributeName: editExtractor === 'attribute' ? editAttr.trim() : undefined,
      regexPattern: editExtractor === 'regex' ? editRegex : undefined,
      regexGroup: editExtractor === 'regex' ? Math.max(0, Number.parseInt(editRegexGroup, 10) || 0) : undefined,
      required: editRequired,
    });
    setIsEditing(false);
  };

  return (
    <div
      className={`p-3 rounded-card border text-left ${
        isSelected ? 'bg-surface border-line shadow-xs' : 'bg-surface-sunken border-line-subtle'
      }`}
    >
      {!isEditing ? (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-start gap-2.5 min-w-0">
            <input
              type="checkbox"
              id={checkboxId}
              checked={isSelected}
              onChange={onToggleSelect}
              aria-label={`Include ${field.name}`}
              className="mt-0.5 w-4 h-4 rounded border-line-strong accent-brand cursor-pointer shrink-0"
            />
            <div className="min-w-0">
              <label htmlFor={checkboxId} className="block text-xs font-semibold text-fg cursor-pointer truncate">
                {field.name}
              </label>
              <div className="flex items-center gap-1 flex-wrap mt-0.5">
                <Badge variant="neutral" size="sm">
                  {EXTRACTOR_LABELS[field.extractor]}
                </Badge>
                {field.required && (
                  <Badge variant="warning" size="sm">
                    Required
                  </Badge>
                )}
                {!isSelected && <span className="text-2xs text-fg-subtle">Left out</span>}
              </div>
              {field.discovery && (
                <p className="text-2xs text-fg-subtle mt-0.5 truncate">
                  Found in {Math.round(field.discovery.coverage * field.discovery.sampleSize)} of{' '}
                  {field.discovery.sampleSize} sampled items
                  {field.discovery.sampleValue ? `, such as "${field.discovery.sampleValue}"` : ''}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center shrink-0">
            {(onMoveUp || onMoveDown) && (
              <>
                <IconButton
                  label={`Move ${field.name} up`}
                  icon={<ArrowUp className="w-3.5 h-3.5" />}
                  onClick={onMoveUp}
                  disabled={isFirst || !onMoveUp}
                />
                <IconButton
                  label={`Move ${field.name} down`}
                  icon={<ArrowDown className="w-3.5 h-3.5" />}
                  onClick={onMoveDown}
                  disabled={isLast || !onMoveDown}
                />
              </>
            )}
            <IconButton
              label={`Edit field ${field.name}`}
              icon={<Edit3 className="w-3.5 h-3.5" />}
              onClick={() => setIsEditing(true)}
            />
            <IconButton
              label={`Remove field ${field.name}`}
              variant="danger"
              icon={<Trash2 className="w-3.5 h-3.5" />}
              onClick={onRemove}
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between border-b border-line-subtle pb-2">
            <span className="text-xs font-semibold text-fg">Edit column</span>
            <div className="flex items-center gap-1">
              <IconButton
                label="Cancel edit"
                icon={<X className="w-3.5 h-3.5" />}
                onClick={() => {
                  resetEdits();
                  setIsEditing(false);
                }}
              />
              <IconButton
                label="Save field edits"
                variant="brand"
                icon={<Check className="w-3.5 h-3.5" />}
                onClick={handleSave}
              />
            </div>
          </div>

          <Input
            label="Column name"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="e.g. Price"
          />
          <Select
            label="What to collect"
            value={editExtractor}
            options={[
              ...EXTRACTOR_ORDER,
              // Detection assigns these to table columns and link texts; they are kept, not offered.
              ...(field.extractor === 'table_cell' || field.extractor === 'link_text' ? [field.extractor] : []),
            ].map((value) => ({ value, label: EXTRACTOR_LABELS[value] }))}
            onChange={(e) => {
              setEditExtractor(e.target.value as FieldExtractorType);
              setErrors({});
            }}
          />

          {editExtractor === 'attribute' && (
            <div className="flex items-start gap-1">
              <Input
                label="Attribute name"
                value={editAttr}
                onChange={(e) => setEditAttr(e.target.value)}
                placeholder="e.g. data-id or aria-label"
                error={errors.attribute}
              />
              <HelpTip tipId="attribute-extractor" className="mt-5" />
            </div>
          )}

          {editExtractor === 'regex' && (
            <div className="flex flex-col gap-2">
              <div className="flex items-start gap-1">
                <Input
                  label="Pattern"
                  value={editRegex}
                  onChange={(e) => setEditRegex(e.target.value)}
                  placeholder="e.g. SKU-(\d+)"
                  error={errors.regex}
                />
                <HelpTip tipId="regex-extractor" className="mt-5" />
              </div>
              <Input
                type="number"
                min={0}
                label="Part to keep"
                value={editRegexGroup}
                onChange={(e) => setEditRegexGroup(e.target.value)}
                helperText="0 keeps the whole match; 1 keeps the first part in brackets."
              />
            </div>
          )}

          <div className="flex items-start gap-1">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={editRequired}
                onChange={(e) => setEditRequired(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-line-strong accent-brand"
              />
              <span className="text-xs text-fg-muted">
                Skip rows where this column is empty
                <span className="block text-2xs text-fg-subtle">
                  Off by default, so rows with a missing value are kept. Skipped rows are counted.
                </span>
              </span>
            </label>
            <HelpTip tipId="required-field" />
          </div>

          <Disclosure label="Where to find it on the page">
            <Input
              label="CSS selector inside each item"
              value={editSelector}
              onChange={(e) => setEditSelector(e.target.value)}
              placeholder="e.g. .price"
              helperText="Only change this if the column picks up the wrong part of the item."
            />
          </Disclosure>
        </div>
      )}
    </div>
  );
};

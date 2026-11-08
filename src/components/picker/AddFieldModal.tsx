import React, { useState } from 'react';
import { Dialog } from '@/components/common/Dialog';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Select } from '@/components/common/Select';
import { HelpTip } from '@/components/common/Tooltip';
import { FieldDefinition, FieldExtractorType } from '@/types';
import { EXTRACTOR_LABELS, EXTRACTOR_ORDER, regexProblem } from './FieldEditorRow';

export interface AddFieldModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (field: FieldDefinition) => void;
}

type FieldErrors = Partial<Record<'name' | 'selector' | 'attribute' | 'regex', string>>;

/** Adds a column by hand, in the same words as the column editor. Each problem shows on its field. */
export const AddFieldModal: React.FC<AddFieldModalProps> = ({ isOpen, onClose, onAdd }) => {
  const [name, setName] = useState('');
  const [selector, setSelector] = useState('');
  const [extractor, setExtractor] = useState<FieldExtractorType>('text');
  const [attributeName, setAttributeName] = useState('');
  const [regexPattern, setRegexPattern] = useState('');
  const [regexGroup, setRegexGroup] = useState('0');
  const [errors, setErrors] = useState<FieldErrors>({});

  const clearError = (key: keyof FieldErrors) => setErrors((current) => ({ ...current, [key]: undefined }));

  const handleSubmit = (event?: React.FormEvent) => {
    event?.preventDefault();
    const next: FieldErrors = {};
    if (!name.trim()) next.name = 'Give the column a name.';
    if (!selector.trim()) next.selector = 'Say where the value is inside each item, such as .price.';
    if (extractor === 'attribute' && !attributeName.trim()) {
      next.attribute = 'Name the attribute to read, such as data-id.';
    }
    if (extractor === 'regex') {
      const problem = regexProblem(regexPattern);
      if (problem) next.regex = problem;
    }
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;

    onAdd({
      id: 'field_' + Math.random().toString(36).substring(2, 9),
      name: name.trim(),
      selector: selector.trim(),
      extractor,
      attributeName: extractor === 'attribute' ? attributeName.trim() : undefined,
      regexPattern: extractor === 'regex' ? regexPattern : undefined,
      regexGroup: extractor === 'regex' ? Math.max(0, Number.parseInt(regexGroup, 10) || 0) : undefined,
    });
    handleClose();
  };

  const handleClose = () => {
    setName('');
    setSelector('');
    setExtractor('text');
    setAttributeName('');
    setRegexPattern('');
    setRegexGroup('0');
    setErrors({});
    onClose();
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      title="Add a column"
      description="Collect one more piece of information from every item."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={handleClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={() => handleSubmit()}>
            Add Column
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
        <Input
          label="Column name"
          placeholder="e.g. Rating"
          value={name}
          error={errors.name}
          onChange={(e) => {
            setName(e.target.value);
            clearError('name');
          }}
        />

        <Select
          label="What to collect"
          value={extractor}
          options={EXTRACTOR_ORDER.map((value) => ({ value, label: EXTRACTOR_LABELS[value] }))}
          onChange={(e) => {
            setExtractor(e.target.value as FieldExtractorType);
            setErrors((current) => ({ ...current, attribute: undefined, regex: undefined }));
          }}
        />

        <Input
          label="CSS selector inside each item"
          placeholder="e.g. span.rating"
          value={selector}
          error={errors.selector}
          helperText="Find it with your browser's Inspect tool, on one of the items."
          onChange={(e) => {
            setSelector(e.target.value);
            clearError('selector');
          }}
        />

        {extractor === 'attribute' && (
          <div className="flex items-start gap-1">
            <Input
              label="Attribute name"
              placeholder="e.g. data-rating or title"
              value={attributeName}
              error={errors.attribute}
              onChange={(e) => {
                setAttributeName(e.target.value);
                clearError('attribute');
              }}
            />
            <HelpTip tipId="attribute-extractor" className="mt-5" />
          </div>
        )}

        {extractor === 'regex' && (
          <div className="flex flex-col gap-2">
            <div className="flex items-start gap-1">
              <Input
                label="Pattern"
                placeholder={'e.g. SKU-(\\d+)'}
                value={regexPattern}
                error={errors.regex}
                onChange={(e) => {
                  setRegexPattern(e.target.value);
                  clearError('regex');
                }}
              />
              <HelpTip tipId="regex-extractor" className="mt-5" />
            </div>
            <Input
              type="number"
              min={0}
              label="Part to keep"
              value={regexGroup}
              onChange={(e) => setRegexGroup(e.target.value)}
              helperText="0 keeps the whole match; 1 keeps the first part in brackets."
            />
          </div>
        )}
      </form>
    </Dialog>
  );
};

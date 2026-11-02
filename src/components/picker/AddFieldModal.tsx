import React, { useState } from 'react';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Select } from '@/components/common/Select';
import { FieldDefinition, FieldExtractorType } from '@/types';
import { regexProblem } from './FieldEditorRow';

export interface AddFieldModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (field: FieldDefinition) => void;
}

export const AddFieldModal: React.FC<AddFieldModalProps> = ({
  isOpen,
  onClose,
  onAdd,
}) => {
  const [name, setName] = useState('');
  const [selector, setSelector] = useState('');
  const [extractor, setExtractor] = useState<FieldExtractorType>('text');
  const [attributeName, setAttributeName] = useState('');
  const [regexPattern, setRegexPattern] = useState('');
  const [regexGroup, setRegexGroup] = useState('0');
  const [error, setError] = useState('');

  const extractorOptions: { value: FieldExtractorType; label: string }[] = [
    { value: 'text', label: 'Text content' },
    { value: 'href', label: 'Link URL (href)' },
    { value: 'src', label: 'Image URL (src)' },
    { value: 'number', label: 'Number / Price' },
    { value: 'html', label: 'Raw HTML' },
    { value: 'attribute', label: 'HTML Attribute' },
    { value: 'regex', label: 'Regex Pattern' },
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please provide a column name.');
      return;
    }
    if (!selector.trim()) {
      setError('Please provide a CSS selector.');
      return;
    }
    if (extractor === 'attribute' && !attributeName.trim()) {
      setError('Attribute name is required for attribute extractor.');
      return;
    }
    if (extractor === 'regex') {
      const problem = regexProblem(regexPattern);
      if (problem) {
        setError(problem);
        return;
      }
    }

    const newField: FieldDefinition = {
      id: 'field_' + Math.random().toString(36).substring(2, 9),
      name: name.trim(),
      selector: selector.trim(),
      extractor,
      attributeName: extractor === 'attribute' ? attributeName.trim() : undefined,
      regexPattern: extractor === 'regex' ? regexPattern : undefined,
      regexGroup: extractor === 'regex' ? Number(regexGroup) || 0 : undefined,
    };

    onAdd(newField);
    handleClose();
  };

  const handleClose = () => {
    setName('');
    setSelector('');
    setExtractor('text');
    setAttributeName('');
    setRegexPattern('');
    setRegexGroup('0');
    setError('');
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Add Custom Column"
      description="Define an extraction field for each record in the list."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={handleClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSubmit}>
            Add Column
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {error && (
          <div className="p-2 rounded bg-rose-50 border border-rose-200 text-xs text-rose-700">
            {error}
          </div>
        )}

        <Input
          label="Column Name"
          placeholder="e.g. Product Rating"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError('');
          }}
          required
        />

        <Select
          label="Extractor Type"
          value={extractor}
          options={extractorOptions}
          onChange={(e) => setExtractor(e.target.value as FieldExtractorType)}
        />

        <Input
          label="Relative CSS Selector"
          placeholder="e.g. span.rating, a.review-count"
          value={selector}
          onChange={(e) => {
            setSelector(e.target.value);
            setError('');
          }}
          helperText="Relative to the container element"
          required
        />

        {extractor === 'attribute' && (
          <Input
            label="Attribute Name"
            placeholder="e.g. data-rating or title"
            value={attributeName}
            onChange={(e) => setAttributeName(e.target.value)}
            required
          />
        )}

        {extractor === 'regex' && (
          <div className="grid grid-cols-2 gap-2">
            <Input
              label="Regex Pattern"
              placeholder="e.g. SKU-(\\d+)"
              value={regexPattern}
              onChange={(e) => {
                setRegexPattern(e.target.value);
                setError('');
              }}
              required
            />
            <Input
              type="number"
              min={0}
              label="Capture Group"
              value={regexGroup}
              onChange={(e) => setRegexGroup(e.target.value)}
            />
          </div>
        )}
      </form>
    </Modal>
  );
};

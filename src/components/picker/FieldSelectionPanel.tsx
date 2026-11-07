import React, { useState } from 'react';
import { Plus, ArrowLeft, ArrowRight, Play, AlertCircle, CheckSquare, Square, Save } from 'lucide-react';
import { Banner } from '@/components/common/Banner';
import { Button } from '@/components/common/Button';
import { Badge } from '@/components/common/Badge';
import { Input } from '@/components/common/Input';
import { Select } from '@/components/common/Select';
import { validateUrlTemplate } from '@/core/navigation/url-paginator';
import { ExtractionProject } from '@/shared/contracts/project';
import { FieldEditorRow } from './FieldEditorRow';
import { FieldPreview } from './FieldPreview';
import { AddFieldModal } from './AddFieldModal';
import { PaginationConfigPanel } from './PaginationConfigPanel';
import { describePagination } from './pagination-copy';
import { FieldDefinition, ExtractionPaginationConfig } from '@/types';
import { DetectedList } from '@/hooks/useExtractionWorkflow';
import type { FieldPreviewResult } from '@/shared/contracts/message';

export type ConfigStep = 'fields' | 'pagination';

export interface FieldSelectionPanelProps {
  detectedList: DetectedList;
  fields: FieldDefinition[];
  selectedFieldIds: Set<string>;
  pagination: ExtractionPaginationConfig;
  sourceUrl?: string;
  projects?: ExtractionProject[];
  selectedProjectId?: string;
  /** Which half of the configuration is on screen: Review fields, or Pagination. */
  step?: ConfigStep;
  onStepChange?: (step: ConfigStep) => void;
  onSelectProject?: (projectId: string | undefined) => void;
  /** Saves this configuration as a recipe. Rejects if it was not saved. */
  onSaveRecipe?: (name: string) => Promise<void>;
  onToggleField: (id: string) => void;
  onUpdateField: (id: string, updates: Partial<FieldDefinition>) => void;
  onMoveField?: (id: string, direction: -1 | 1) => void;
  /** Reads real rows for the chosen columns from the page, for the preview. */
  onPreviewFields?: (columns: FieldDefinition[]) => Promise<FieldPreviewResult>;
  onAddField: (field: FieldDefinition) => void;
  onRemoveField: (id: string) => void;
  onPaginationChange: (updates: Partial<ExtractionPaginationConfig>) => void;
  onBack: () => void;
  onStartHarvest: () => void;
}

export const FieldSelectionPanel: React.FC<FieldSelectionPanelProps> = ({
  detectedList,
  fields,
  selectedFieldIds,
  pagination,
  sourceUrl,
  projects = [],
  selectedProjectId,
  step = 'fields',
  onStepChange,
  onSelectProject,
  onSaveRecipe,
  onToggleField,
  onUpdateField,
  onMoveField,
  onPreviewFields,
  onAddField,
  onRemoveField,
  onPaginationChange,
  onBack,
  onStartHarvest,
}) => {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [recipeName, setRecipeName] = useState('');
  const [isSavingRecipe, setIsSavingRecipe] = useState(false);
  const [recipeResult, setRecipeResult] = useState<{ ok: boolean; message: string } | null>(null);

  const selectedFields = fields.filter((f) => selectedFieldIds.has(f.id));
  const selectedCount = selectedFields.length;
  const allSelected = fields.length > 0 && selectedCount === fields.length;
  const templateCheck =
    pagination.type === 'url_template'
      ? validateUrlTemplate(
          {
            template: pagination.urlTemplate,
            startPage: pagination.startPage,
            pageIncrement: pagination.pageIncrement,
          },
          sourceUrl
        )
      : { valid: true };

  const handleSaveRecipe = async () => {
    if (!onSaveRecipe) return;
    const name = recipeName.trim();
    if (!name) {
      setRecipeResult({ ok: false, message: 'Give the recipe a name first.' });
      return;
    }
    setIsSavingRecipe(true);
    setRecipeResult(null);
    try {
      await onSaveRecipe(name);
      setRecipeResult({ ok: true, message: `Saved recipe "${name}".` });
      setRecipeName('');
    } catch (error: unknown) {
      setRecipeResult({
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsSavingRecipe(false);
    }
  };

  const handleToggleAll = () => {
    fields.forEach((f) => {
      if (allSelected && selectedFieldIds.has(f.id)) {
        onToggleField(f.id);
      } else if (!allSelected && !selectedFieldIds.has(f.id)) {
        onToggleField(f.id);
      }
    });
  };

  const startButton = (
    <Button
      variant="primary"
      size="lg"
      className="w-full justify-center font-semibold text-sm"
      iconLeft={<Play aria-hidden="true" className="w-4 h-4 fill-current" />}
      disabled={selectedCount === 0 || !templateCheck.valid}
      onClick={onStartHarvest}
    >
      Start extraction ({selectedCount} {selectedCount === 1 ? 'column' : 'columns'})
    </Button>
  );

  const noColumnsNote = selectedCount === 0 && (
    <p className="text-2xs text-danger-fg text-center mt-1.5 flex items-center justify-center gap-1">
      <AlertCircle aria-hidden="true" className="w-3 h-3" />
      <span>Select at least one column to start.</span>
    </p>
  );

  if (step === 'pagination') {
    return (
      <div className="flex flex-col gap-4 p-4 text-left">
        <div>
          <Button
            variant="ghost"
            size="xs"
            iconLeft={<ArrowLeft aria-hidden="true" className="w-3.5 h-3.5" />}
            onClick={() => onStepChange?.('fields')}
          >
            Back to fields
          </Button>
        </div>

        <PaginationConfigPanel config={pagination} sourceUrl={sourceUrl} onChange={onPaginationChange} />

        {onSelectProject && (
          <Select
            label="Project"
            value={selectedProjectId ?? ''}
            options={[
              { value: '', label: 'Automatic (group by website)' },
              ...projects.map((project) => ({ value: project.id, label: project.name })),
            ]}
            onChange={(e) => onSelectProject(e.target.value || undefined)}
          />
        )}

        {onSaveRecipe && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Input
                  label="Recipe Name"
                  placeholder="e.g. Product catalog"
                  value={recipeName}
                  onChange={(e) => setRecipeName(e.target.value)}
                  helperText="Save these settings to run them again later."
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                iconLeft={<Save aria-hidden="true" className="w-3.5 h-3.5" />}
                isLoading={isSavingRecipe}
                disabled={selectedCount === 0}
                onClick={() => void handleSaveRecipe()}
              >
                Save Recipe
              </Button>
            </div>
            {recipeResult && <Banner tone={recipeResult.ok ? 'success' : 'danger'}>{recipeResult.message}</Banner>}
          </div>
        )}

        <div className="pt-1">
          {startButton}
          {noColumnsNote}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4 text-left">
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="xs"
          iconLeft={<ArrowLeft aria-hidden="true" className="w-3.5 h-3.5" />}
          onClick={onBack}
        >
          Back to list
        </Button>
        {detectedList.matchCount > 0 && (
          <Badge variant="neutral" size="sm">
            {detectedList.matchCount} items on page
          </Badge>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-fg leading-tight">Choose your columns</h2>
          <p className="text-xs text-fg-subtle mt-0.5">
            {selectedCount} of {fields.length} columns selected
          </p>
        </div>
        <div className="flex items-center gap-1">
          {fields.length > 0 && (
            <Button
              variant="ghost"
              size="xs"
              iconLeft={
                allSelected ? (
                  <CheckSquare aria-hidden="true" className="w-3.5 h-3.5 text-brand-fg" />
                ) : (
                  <Square aria-hidden="true" className="w-3.5 h-3.5" />
                )
              }
              onClick={handleToggleAll}
            >
              {allSelected ? 'Deselect All' : 'Select All'}
            </Button>
          )}
          <Button
            variant="outline"
            size="xs"
            iconLeft={<Plus aria-hidden="true" className="w-3 h-3" />}
            onClick={() => setIsAddModalOpen(true)}
          >
            Add Column
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {fields.length === 0 ? (
          <div className="p-4 rounded-card border border-dashed border-line text-center text-xs text-fg-subtle">
            No columns were suggested. Press "Add Column" to define one.
          </div>
        ) : (
          fields.map((field, index) => (
            <FieldEditorRow
              key={field.id}
              field={field}
              isSelected={selectedFieldIds.has(field.id)}
              onToggleSelect={() => onToggleField(field.id)}
              onUpdate={(updates) => onUpdateField(field.id, updates)}
              onRemove={() => onRemoveField(field.id)}
              onMoveUp={onMoveField ? () => onMoveField(field.id, -1) : undefined}
              onMoveDown={onMoveField ? () => onMoveField(field.id, 1) : undefined}
              isFirst={index === 0}
              isLast={index === fields.length - 1}
            />
          ))
        )}
      </div>

      <FieldPreview columns={selectedFields} samples={detectedList.sampleSnippets} onPreview={onPreviewFields} />

      <div className="flex flex-col gap-2 pt-1">
        <p className="text-2xs text-fg-muted">More pages: {describePagination(pagination)}</p>
        {onStepChange && (
          <Button
            variant="outline"
            className="w-full justify-center"
            iconRight={<ArrowRight aria-hidden="true" className="w-3.5 h-3.5" />}
            onClick={() => onStepChange('pagination')}
          >
            Next: Pagination
          </Button>
        )}
        {startButton}
        {noColumnsNote}
      </div>

      <AddFieldModal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} onAdd={onAddField} />
    </div>
  );
};

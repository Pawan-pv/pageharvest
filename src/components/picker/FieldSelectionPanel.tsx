import React, { useState } from 'react';
import { Plus, ArrowLeft, Play, AlertCircle, CheckSquare, Square, Save } from 'lucide-react';
import { Alert } from '@/components/common/Alert';
import { Button } from '@/components/common/Button';
import { Badge } from '@/components/common/Badge';
import { Input } from '@/components/common/Input';
import { Select } from '@/components/common/Select';
import { validateUrlTemplate } from '@/core/navigation/url-paginator';
import { ExtractionProject } from '@/shared/contracts/project';
import { FieldEditorRow } from './FieldEditorRow';
import { AddFieldModal } from './AddFieldModal';
import { PaginationConfigPanel } from './PaginationConfigPanel';
import {
  FieldDefinition,
  ExtractionPaginationConfig
} from '@/types';
import { DetectedList } from '@/hooks/useExtractionWorkflow';

export interface FieldSelectionPanelProps {
  detectedList: DetectedList;
  fields: FieldDefinition[];
  selectedFieldIds: Set<string>;
  pagination: ExtractionPaginationConfig;
  sourceUrl?: string;
  projects?: ExtractionProject[];
  selectedProjectId?: string;
  onSelectProject?: (projectId: string | undefined) => void;
  /** Saves this configuration as a recipe. Rejects if it was not saved. */
  onSaveRecipe?: (name: string) => Promise<void>;
  onToggleField: (id: string) => void;
  onUpdateField: (id: string, updates: Partial<FieldDefinition>) => void;
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
  onSelectProject,
  onSaveRecipe,
  onToggleField,
  onUpdateField,
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

  const selectedCount = fields.filter((f) => selectedFieldIds.has(f.id)).length;
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

  return (
    <div className="flex flex-col gap-4 p-4 text-left">
      {/* Top Bar with back button */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to list selection</span>
        </button>

        {detectedList.matchCount > 0 && (
          <Badge variant="neutral" size="sm">
            {detectedList.matchCount} items on page
          </Badge>
        )}
      </div>

      {/* Columns Header & Toggle All */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 leading-tight">
            Columns to Extract
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {selectedCount} of {fields.length} columns selected
          </p>
        </div>

        <div className="flex items-center gap-2">
          {fields.length > 0 && (
            <button
              onClick={handleToggleAll}
              className="text-xs text-slate-600 hover:text-slate-900 flex items-center gap-1 p-1"
            >
              {allSelected ? (
                <>
                  <CheckSquare className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Deselect All</span>
                </>
              ) : (
                <>
                  <Square className="w-3.5 h-3.5 text-slate-400" />
                  <span>Select All</span>
                </>
              )}
            </button>
          )}
          <Button
            variant="outline"
            size="xs"
            iconLeft={<Plus className="w-3 h-3" />}
            onClick={() => setIsAddModalOpen(true)}
          >
            Add Column
          </Button>
        </div>
      </div>

      {/* Field List */}
      <div className="flex flex-col gap-2">
        {fields.length === 0 ? (
          <div className="p-4 rounded-xl border border-dashed border-slate-200 text-center text-xs text-slate-400">
            No fields detected. Click "Add Column" to manually define one.
          </div>
        ) : (
          fields.map((field) => (
            <FieldEditorRow
              key={field.id}
              field={field}
              isSelected={selectedFieldIds.has(field.id)}
              onToggleSelect={() => onToggleField(field.id)}
              onUpdate={(updates) => onUpdateField(field.id, updates)}
              onRemove={() => onRemoveField(field.id)}
            />
          ))
        )}
      </div>

      {/* Pagination Configuration */}
      <PaginationConfigPanel
        config={pagination}
        sourceUrl={sourceUrl}
        onChange={onPaginationChange}
      />

      {/* Project the resulting dataset belongs to */}
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

      {/* Save this configuration for later */}
      {onSaveRecipe && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                label="Recipe Name"
                placeholder="e.g. Product catalog"
                value={recipeName}
                onChange={(e) => setRecipeName(e.target.value)}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              iconLeft={<Save className="w-3.5 h-3.5" />}
              isLoading={isSavingRecipe}
              disabled={selectedCount === 0}
              onClick={() => void handleSaveRecipe()}
            >
              Save Recipe
            </Button>
          </div>
          {recipeResult && (
            <Alert variant={recipeResult.ok ? 'success' : 'error'}>{recipeResult.message}</Alert>
          )}
        </div>
      )}

      {/* Primary Action Button */}
      <div className="pt-2">
        <Button
          variant="primary"
          size="lg"
          className="w-full justify-center shadow-md font-semibold text-sm"
          iconLeft={<Play className="w-4 h-4 fill-current" />}
          disabled={selectedCount === 0 || !templateCheck.valid}
          onClick={onStartHarvest}
        >
          Start Extraction ({selectedCount} {selectedCount === 1 ? 'column' : 'columns'})
        </Button>

        {selectedCount === 0 && (
          <p className="text-[11px] text-rose-500 text-center mt-1.5 flex items-center justify-center gap-1">
            <AlertCircle className="w-3 h-3" />
            <span>Select at least one column to start harvesting</span>
          </p>
        )}
      </div>

      {/* Add Custom Field Modal */}
      <AddFieldModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAdd={onAddField}
      />
    </div>
  );
};

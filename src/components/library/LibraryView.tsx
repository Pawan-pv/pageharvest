import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Play, Pencil, Trash2, Plus } from 'lucide-react';
import { Banner } from '@/components/common/Banner';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { EmptyState } from '@/components/common/EmptyState';
import { Input } from '@/components/common/Input';
import { Dialog } from '@/components/common/Dialog';
import { ExtractionHistoryView, ExtractionHistoryViewProps } from '@/components/history/ExtractionHistoryView';
import { JobStatus } from '@/shared/contracts/job';
import { ExtractionProject } from '@/shared/contracts/project';
import { ExtractionSchema } from '@/shared/contracts/schema';
import {
  HistoryRepository,
  ProjectRepository,
  ProjectUsage,
  RecipeRepository,
  SchemaRepository,
} from '@/storage/repositories';
import { ExtractionRecipe, ExtractionRunHistory } from '@/types';

type LibraryTab = 'datasets' | 'projects' | 'recipes' | 'schemas' | 'history';

const TABS: { id: LibraryTab; label: string }[] = [
  { id: 'datasets', label: 'Saved Data' },
  { id: 'projects', label: 'Projects' },
  { id: 'recipes', label: 'Recipes' },
  { id: 'schemas', label: 'Schemas' },
  { id: 'history', label: 'Run History' },
];

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Loads a list from a repository and reports failures instead of showing an empty list. */
function useLoadedList<T>(load: () => Promise<T[]>) {
  const [items, setItems] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      setItems(await load());
    } catch (err) {
      setError(errorText(err));
    } finally {
      setIsLoading(false);
    }
  }, [load]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { items, isLoading, error, setError, reload };
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

const ProjectsPanel: React.FC<{ onNewExtraction: () => void }> = ({ onNewExtraction }) => {
  const repository = useMemo(() => new ProjectRepository(), []);
  const load = useCallback(() => repository.getAllProjects(), [repository]);
  const { items: projects, isLoading, error, setError, reload } = useLoadedList(load);

  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<ExtractionProject | null>(null);
  const [editName, setEditName] = useState('');
  const [deleting, setDeleting] = useState<{ project: ExtractionProject; usage: ProjectUsage } | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      setError('Give the project a name.');
      return;
    }
    setIsWorking(true);
    try {
      const now = Date.now();
      await repository.createProject({
        id: `project_${now}_${Math.random().toString(36).slice(2, 8)}`,
        name,
        status: 'draft',
        tags: [],
        createdAt: now,
        updatedAt: now,
      });
      setNewName('');
      await reload();
    } catch (err) {
      setError(`The project was not created: ${errorText(err)}`);
    } finally {
      setIsWorking(false);
    }
  };

  const handleRename = async () => {
    if (!editing || !editName.trim()) return;
    setIsWorking(true);
    try {
      await repository.updateProject(editing.id, { name: editName.trim() });
      setEditing(null);
      await reload();
    } catch (err) {
      setEditing(null);
      setError(`The project was not renamed: ${errorText(err)}`);
    } finally {
      setIsWorking(false);
    }
  };

  const askToDelete = async (project: ExtractionProject) => {
    try {
      setDeleting({ project, usage: await repository.getUsage(project.id) });
    } catch (err) {
      setError(errorText(err));
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setIsWorking(true);
    try {
      await repository.deleteProject(deleting.project.id);
      setDeleting(null);
      await reload();
    } catch (err) {
      setDeleting(null);
      setError(`The project was not deleted: ${errorText(err)}`);
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {error && <Banner tone="danger" onDismiss={() => setError(null)}>{error}</Banner>}

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            label="New Project"
            placeholder="e.g. Competitor pricing"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          iconLeft={<Plus className="w-3.5 h-3.5" />}
          isLoading={isWorking}
          onClick={() => void handleCreate()}
        >
          Create Project
        </Button>
      </div>

      {!isLoading && projects.length === 0 && (
        <EmptyState
          title="No projects yet"
          description="Projects group your extractions. One is made for each website when you run an extraction, or you can create one above."
          action={{ label: 'Start an extraction', onClick: onNewExtraction }}
        />
      )}

      {projects.map((project) => (
        <Card key={project.id} variant="flat" className="p-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-xs font-semibold text-fg truncate">{project.name}</h3>
            {project.targetUrl && (
              <p className="text-2xs text-fg-subtle truncate">{project.targetUrl}</p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              aria-label={`Rename project ${project.name}`}
              className="p-1 text-fg-subtle hover:text-fg-muted rounded"
              onClick={() => {
                setEditing(project);
                setEditName(project.name);
              }}
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              aria-label={`Delete project ${project.name}`}
              className="p-1 text-fg-subtle hover:text-danger-fg rounded"
              onClick={() => void askToDelete(project)}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </Card>
      ))}

      <Dialog
        isOpen={editing !== null}
        onClose={() => setEditing(null)}
        title="Rename Project"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" size="sm" isLoading={isWorking} onClick={() => void handleRename()}>
              Save Project
            </Button>
          </>
        }
      >
        <Input label="Project Name" value={editName} onChange={(e) => setEditName(e.target.value)} />
      </Dialog>

      <Dialog
        isOpen={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete Project?"
        description={
          deleting
            ? `This permanently deletes ${deleting.usage.datasets} dataset(s), ${deleting.usage.records} row(s) and ${deleting.usage.jobs} run(s). Saved recipes and schemas are kept.`
            : undefined
        }
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="danger" size="sm" isLoading={isWorking} onClick={() => void handleDelete()}>
              Delete Project
            </Button>
          </>
        }
      >
        <p className="text-xs text-fg-muted">This action cannot be undone.</p>
      </Dialog>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

const RecipesPanel: React.FC<{ onRunRecipe: (recipe: ExtractionRecipe) => void; onNewExtraction: () => void }> = ({
  onRunRecipe,
  onNewExtraction,
}) => {
  const repository = useMemo(() => new RecipeRepository(), []);
  const load = useCallback(() => repository.getAllRecipes(), [repository]);
  const { items: recipes, isLoading, error, setError, reload } = useLoadedList(load);

  const [editing, setEditing] = useState<ExtractionRecipe | null>(null);
  const [draft, setDraft] = useState({ name: '', urlPattern: '', containerSelector: '' });
  const [deleting, setDeleting] = useState<ExtractionRecipe | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  const openEditor = (recipe: ExtractionRecipe) => {
    setEditing(recipe);
    setDraft({
      name: recipe.name,
      urlPattern: recipe.urlPattern,
      containerSelector: recipe.containerSelector,
    });
  };

  const handleSave = async () => {
    if (!editing) return;
    if (!draft.name.trim() || !draft.containerSelector.trim()) {
      setError('A recipe needs a name and a container selector.');
      return;
    }
    setIsWorking(true);
    try {
      await repository.updateRecipe(editing.id, {
        name: draft.name.trim(),
        urlPattern: draft.urlPattern.trim(),
        containerSelector: draft.containerSelector.trim(),
      });
      setEditing(null);
      await reload();
    } catch (err) {
      setEditing(null);
      setError(`The recipe was not saved: ${errorText(err)}`);
    } finally {
      setIsWorking(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setIsWorking(true);
    try {
      await repository.deleteRecipe(deleting.id);
      setDeleting(null);
      await reload();
    } catch (err) {
      setDeleting(null);
      setError(`The recipe was not deleted: ${errorText(err)}`);
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {error && <Banner tone="danger" onDismiss={() => setError(null)}>{error}</Banner>}

      {!isLoading && recipes.length === 0 && (
        <EmptyState
          title="No saved recipes"
          description='A recipe runs the same extraction again later. Save one with "Save Recipe" on the Pagination step.'
          action={{ label: 'Start an extraction', onClick: onNewExtraction }}
        />
      )}

      {recipes.map((recipe) => (
        <Card key={recipe.id} variant="flat" className="p-3 flex flex-col gap-2">
          <div className="min-w-0">
            <h3 className="text-xs font-semibold text-fg truncate">{recipe.name}</h3>
            <p className="text-2xs text-fg-subtle truncate">{recipe.urlPattern}</p>
            <p className="text-2xs text-fg-subtle mt-0.5">
              {recipe.fields.length} columns, {recipe.pagination?.type ?? 'none'}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="primary"
              size="xs"
              iconLeft={<Play className="w-3 h-3 fill-current" />}
              aria-label={`Run recipe ${recipe.name}`}
              onClick={() => onRunRecipe(recipe)}
            >
              Run
            </Button>
            <Button
              variant="outline"
              size="xs"
              aria-label={`Edit recipe ${recipe.name}`}
              onClick={() => openEditor(recipe)}
            >
              Edit
            </Button>
            <Button
              variant="ghost"
              size="xs"
              aria-label={`Delete recipe ${recipe.name}`}
              onClick={() => setDeleting(recipe)}
            >
              Delete
            </Button>
          </div>
        </Card>
      ))}

      <Dialog
        isOpen={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit Recipe"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" size="sm" isLoading={isWorking} onClick={() => void handleSave()}>
              Save Changes
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2.5">
          <Input
            label="Recipe Title"
            value={draft.name}
            onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
          />
          <Input
            label="URL Pattern"
            value={draft.urlPattern}
            onChange={(e) => setDraft((prev) => ({ ...prev, urlPattern: e.target.value }))}
          />
          <Input
            label="Container Selector"
            value={draft.containerSelector}
            onChange={(e) => setDraft((prev) => ({ ...prev, containerSelector: e.target.value }))}
          />
        </div>
      </Dialog>

      <Dialog
        isOpen={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete Recipe?"
        description={deleting ? `"${deleting.name}" will be removed. Datasets it produced are kept.` : undefined}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="danger" size="sm" isLoading={isWorking} onClick={() => void handleDelete()}>
              Delete Recipe
            </Button>
          </>
        }
      >
        <p className="text-xs text-fg-muted">This action cannot be undone.</p>
      </Dialog>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const SchemasPanel: React.FC<{ onUseSchema: (schema: ExtractionSchema) => void; onNewExtraction: () => void }> = ({
  onUseSchema,
  onNewExtraction,
}) => {
  const repository = useMemo(() => new SchemaRepository(), []);
  const load = useCallback(() => repository.getAllSchemas(), [repository]);
  const { items: schemas, isLoading, error, setError, reload } = useLoadedList(load);

  const [editing, setEditing] = useState<ExtractionSchema | null>(null);
  const [draft, setDraft] = useState({ name: '', containerSelector: '' });
  const [isWorking, setIsWorking] = useState(false);

  const handleSave = async () => {
    if (!editing) return;
    if (!draft.name.trim() || !draft.containerSelector.trim()) {
      setError('A schema needs a name and a container selector.');
      return;
    }
    setIsWorking(true);
    try {
      await repository.updateSchema(editing.id, {
        name: draft.name.trim(),
        containerSelector: draft.containerSelector.trim(),
      });
      setEditing(null);
      await reload();
    } catch (err) {
      setEditing(null);
      setError(`The schema was not saved: ${errorText(err)}`);
    } finally {
      setIsWorking(false);
    }
  };

  const handleDelete = async (schema: ExtractionSchema) => {
    try {
      await repository.deleteSchema(schema.id);
      await reload();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {error && <Banner tone="danger" onDismiss={() => setError(null)}>{error}</Banner>}

      {!isLoading && schemas.length === 0 && (
        <EmptyState
          title="No schemas yet"
          description="Every extraction saves the list and columns it used here, so you can use them again."
          action={{ label: 'Start an extraction', onClick: onNewExtraction }}
        />
      )}

      {schemas.map((schema) => (
        <Card key={schema.id} variant="flat" className="p-3 flex flex-col gap-2">
          <div className="min-w-0">
            <h3 className="text-xs font-semibold text-fg truncate">{schema.name}</h3>
            <p className="text-2xs font-mono text-fg-subtle truncate">{schema.containerSelector}</p>
            <p className="text-2xs text-fg-subtle mt-0.5">
              {schema.fields.map((field) => field.name).join(', ')}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="primary"
              size="xs"
              aria-label={`Use schema ${schema.name}`}
              onClick={() => onUseSchema(schema)}
            >
              Use
            </Button>
            <Button
              variant="outline"
              size="xs"
              aria-label={`Edit schema ${schema.name}`}
              onClick={() => {
                setEditing(schema);
                setDraft({ name: schema.name, containerSelector: schema.containerSelector });
              }}
            >
              Edit
            </Button>
            <Button
              variant="ghost"
              size="xs"
              aria-label={`Delete schema ${schema.name}`}
              onClick={() => void handleDelete(schema)}
            >
              Delete
            </Button>
          </div>
        </Card>
      ))}

      <Dialog
        isOpen={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit Schema"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" size="sm" isLoading={isWorking} onClick={() => void handleSave()}>
              Save Schema
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2.5">
          <Input
            label="Schema Title"
            value={draft.name}
            onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
          />
          <Input
            label="Schema Container Selector"
            value={draft.containerSelector}
            onChange={(e) => setDraft((prev) => ({ ...prev, containerSelector: e.target.value }))}
          />
        </div>
      </Dialog>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Run history
// ---------------------------------------------------------------------------

const STATUS_VARIANT: Partial<Record<JobStatus, 'success' | 'danger' | 'warning' | 'neutral'>> = {
  COMPLETED: 'success',
  FAILED: 'danger',
  CANCELLED: 'warning',
  EXPIRED: 'neutral',
};

const RunHistoryPanel: React.FC<{ onNewExtraction: () => void }> = ({ onNewExtraction }) => {
  const repository = useMemo(() => new HistoryRepository(), []);
  const load = useCallback(() => repository.getAllHistory(), [repository]);
  const { items: runs, isLoading, error, setError } = useLoadedList<ExtractionRunHistory>(load);

  return (
    <div className="flex flex-col gap-2">
      {error && <Banner tone="danger" onDismiss={() => setError(null)}>{error}</Banner>}

      {!isLoading && runs.length === 0 && (
        <EmptyState
          title="No runs yet"
          description="Finished, failed and cancelled extractions appear here."
          action={{ label: 'Start an extraction', onClick: onNewExtraction }}
        />
      )}

      {runs.map((run) => (
        <Card key={run.id} variant="flat" className="p-3 flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-fg truncate">{run.name ?? run.url ?? run.id}</h3>
            <Badge variant={STATUS_VARIANT[run.status] ?? 'neutral'} size="sm">{run.status}</Badge>
          </div>
          <p className="text-2xs text-fg-subtle">
            {run.totalExtracted} rows, {run.duplicatesSkipped} duplicates skipped
            {run.recordsFiltered ? `, ${run.recordsFiltered} filtered` : ''}
            {run.recordsFailed ? `, ${run.recordsFailed} failed` : ''}
          </p>
          <p className="text-2xs text-fg-subtle">
            {new Date(run.startedAt).toLocaleString()}
            {run.finishedAt ? ` (${Math.max(0, Math.round((run.finishedAt - run.startedAt) / 1000))}s)` : ''}
          </p>
          {run.errorMessage && <p className="text-2xs text-danger-fg">{run.errorMessage}</p>}
        </Card>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

export interface LibraryViewProps extends ExtractionHistoryViewProps {
  onRunRecipe: (recipe: ExtractionRecipe) => void;
  onUseSchema: (schema: ExtractionSchema) => void;
}

export const LibraryView: React.FC<LibraryViewProps> = ({ onRunRecipe, onUseSchema, ...datasetProps }) => {
  const [tab, setTab] = useState<LibraryTab>('datasets');

  return (
    <div className="flex flex-col h-full">
      <nav className="flex flex-wrap gap-1 px-4 pt-3" aria-label="Library sections">
        {TABS.map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            aria-current={tab === item.id ? 'page' : undefined}
            className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
              tab === item.id ? 'bg-brand-soft text-brand-emphasis' : 'text-fg-subtle hover:text-fg'
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {tab === 'datasets' ? (
        <ExtractionHistoryView {...datasetProps} />
      ) : (
        <div className="p-4">
          {tab === 'projects' && <ProjectsPanel onNewExtraction={datasetProps.onNewExtraction} />}
          {tab === 'recipes' && (
            <RecipesPanel onRunRecipe={onRunRecipe} onNewExtraction={datasetProps.onNewExtraction} />
          )}
          {tab === 'schemas' && (
            <SchemasPanel onUseSchema={onUseSchema} onNewExtraction={datasetProps.onNewExtraction} />
          )}
          {tab === 'history' && <RunHistoryPanel onNewExtraction={datasetProps.onNewExtraction} />}
        </div>
      )}
    </div>
  );
};

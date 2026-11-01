import React, { lazy, Suspense, useEffect, useState } from 'react';
import {
  Wheat,
  Settings as SettingsIcon,
  AlertTriangle,
} from 'lucide-react';
import { useActiveTab } from '@/hooks/useActiveTab';
import { useDatasets } from '@/hooks/useDatasets';
import { useExtractionWorkflow } from '@/hooks/useExtractionWorkflow';
import { MainDashboard } from '@/components/dashboard/MainDashboard';
import { ElementSelectionBanner } from '@/components/picker/ElementSelectionBanner';
import { DetectedListPreview } from '@/components/picker/DetectedListPreview';
import { FieldSelectionPanel } from '@/components/picker/FieldSelectionPanel';
import { ExtractionProgressView } from '@/components/dashboard/ExtractionProgressView';
import { Alert } from '@/components/common/Alert';
import { ExtractionJob } from '@/shared/contracts/job';

const DataTable = lazy(() =>
  import('@/components/grid/DataTable').then((module) => ({ default: module.DataTable }))
);
const LibraryView = lazy(() =>
  import('@/components/library/LibraryView').then((module) => ({
    default: module.LibraryView,
  }))
);
const SettingsView = lazy(() =>
  import('@/components/settings/SettingsView').then((module) => ({ default: module.SettingsView }))
);

function describeRecoverableProgress(job: ExtractionJob): string {
  const steps =
    job.progressKind === 'scrolls'
      ? `${job.scrollsCompleted} scrolls`
      : `${job.pagesVisited} pages`;
  return `${steps} / ${job.totalExtracted} rows`;
}

export const App: React.FC = () => {
  const { tab, isLoading: isTabLoading, refreshTab } = useActiveTab();
  const {
    datasets,
    isLoading: isDatasetsLoading,
    error: datasetsError,
    refreshDatasets,
    deleteDataset,
    getDatasetRecords,
  } = useDatasets();

  const workflow = useExtractionWorkflow(tab);

  // Top navigation tabs: 'harvest' | 'datasets' | 'settings'
  const [activeTabNav, setActiveTabNav] = useState<'harvest' | 'datasets' | 'settings'>('harvest');

  // Jobs write datasets from the background, so the list is re-read when the view changes.
  useEffect(() => {
    if (workflow.view === 'dashboard' || workflow.view === 'results') {
      void refreshDatasets();
    }
  }, [workflow.view, refreshDatasets]);

  const handleNavChange = (tabName: 'harvest' | 'datasets' | 'settings') => {
    setActiveTabNav(tabName);
    if (tabName === 'datasets') {
      workflow.setView('history');
      refreshDatasets();
    } else if (tabName === 'settings') {
      workflow.setView('settings');
    } else {
      if (workflow.view === 'history' || workflow.view === 'settings') {
        workflow.setView('dashboard');
      }
    }
  };

  const handleViewDataset = (dataset: (typeof datasets)[0]) => {
    setActiveTabNav('harvest');
    workflow.viewDatasetInTable(dataset);
  };

  const handleNewExtraction = () => {
    setActiveTabNav('harvest');
    workflow.resetToDashboard();
    refreshDatasets();
  };

  const handleCancelExtraction = async () => {
    await workflow.cancelExtraction();
    refreshDatasets();
  };

  const handleDiscardRecoverable = async (jobId: string) => {
    await workflow.discardRecoverableJob(jobId);
    refreshDatasets();
  };

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 text-slate-900 select-none">
      {/* Top Header */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-xs border-b border-slate-200 px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-emerald-600 text-white flex items-center justify-center shadow-xs">
            <Wheat className="w-3.5 h-3.5" />
          </div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-sm font-bold tracking-tight text-slate-900">
              PageHarvest
            </h1>
            <span className="text-[10px] font-medium text-slate-400 bg-slate-100 rounded px-1.5 py-0.2">
              v1.0
            </span>
          </div>
        </div>

        {/* Navigation pill switcher */}
        <nav className="flex items-center p-0.5 rounded-lg bg-slate-100 border border-slate-200/80 text-xs">
          <button
            onClick={() => handleNavChange('harvest')}
            className={`px-2.5 py-1 rounded-md font-medium transition-all ${
              activeTabNav === 'harvest' && workflow.view !== 'history' && workflow.view !== 'settings'
                ? 'bg-white text-emerald-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Harvest
          </button>
          <button
            onClick={() => handleNavChange('datasets')}
            className={`px-2.5 py-1 rounded-md font-medium transition-all ${
              activeTabNav === 'datasets' || workflow.view === 'history'
                ? 'bg-white text-emerald-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Datasets
          </button>
          <button
            onClick={() => handleNavChange('settings')}
            className={`px-2 py-1 rounded-md font-medium transition-all ${
              activeTabNav === 'settings' || workflow.view === 'settings'
                ? 'bg-white text-emerald-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
            aria-label="Settings"
          >
            <SettingsIcon className="w-3.5 h-3.5" />
          </button>
        </nav>
      </header>

      {/* Sessions that can really be resumed: a stored job in RECOVERABLE with a checkpoint */}
      {workflow.recoverableJobs.map((job) => (
        <div
          key={job.id}
          className="m-3 mb-0 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs text-left shadow-xs flex flex-col gap-2"
        >
          <div className="flex items-center justify-between font-semibold">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <span>Interrupted Session Detected</span>
            </div>
            <span className="text-amber-700 font-mono text-[11px]">
              {describeRecoverableProgress(job)}
            </span>
          </div>
          <p className="text-slate-600 leading-snug">
            The extraction at <span className="font-mono text-slate-800">{job.targetUrl}</span> stopped.{' '}
            {job.interruptedReason} All saved rows are safe.
          </p>
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => void workflow.recoverJob(job.id)}
              className="px-2.5 py-1 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-700 font-medium text-white transition"
            >
              Resume Session
            </button>
            <button
              onClick={() => void handleDiscardRecoverable(job.id)}
              className="px-2.5 py-1 text-xs rounded-lg bg-white border border-slate-300 hover:bg-slate-100 font-medium text-slate-700 transition"
            >
              Discard Session
            </button>
          </div>
        </div>
      ))}

      {workflow.operationError && workflow.view !== 'extracting' && (
        <Alert
          variant="error"
          title="PageHarvest operation failed"
          className="m-3 mb-0"
          onDismiss={workflow.clearOperationError}
        >
          {workflow.operationError}
        </Alert>
      )}

      {datasetsError && (
        <Alert variant="error" className="m-3 mb-0">
          {datasetsError}
        </Alert>
      )}

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto flex flex-col">
        {/* 1. Main Dashboard */}
        {workflow.view === 'dashboard' && (
          <MainDashboard
            tab={tab}
            isTabLoading={isTabLoading}
            onRefreshTab={refreshTab}
            datasets={datasets}
            isDatasetsLoading={isDatasetsLoading}
            onSelectElements={workflow.startVisualPicker}
            onAutoDetectLists={workflow.autoDetectLists}
            onExtractTable={() => workflow.startPresetDetection('table tr, table tbody tr')}
            onExtractLinks={() => workflow.startPresetDetection('a[href]')}
            onViewDataset={handleViewDataset}
            onViewAllHistory={() => handleNavChange('datasets')}
          />
        )}

        {/* 2. Visual Element Picking State */}
        {workflow.view === 'inspecting' && (
          <ElementSelectionBanner
            inspectedElement={workflow.inspectedElement}
            onConfirm={() => {
              if (workflow.detectedList) {
                workflow.setView('review_list');
              } else {
                workflow.autoDetectLists();
              }
            }}
            onCancel={workflow.cancelVisualPicker}
          />
        )}

        {/* 3. Detected List Preview */}
        {workflow.view === 'review_list' && workflow.detectedList && (
          <DetectedListPreview
            detectedList={workflow.detectedList}
            onConfirm={() => workflow.confirmListCandidate(workflow.detectedList!)}
            onPickAgain={workflow.startVisualPicker}
            onCancel={workflow.resetToDashboard}
          />
        )}

        {/* 4. Field Selection & Pagination Config */}
        {workflow.view === 'config_fields' && workflow.detectedList && (
          <FieldSelectionPanel
            detectedList={workflow.detectedList}
            fields={workflow.fields}
            selectedFieldIds={workflow.selectedFieldIds}
            pagination={workflow.pagination}
            sourceUrl={tab.url}
            projects={workflow.projects}
            selectedProjectId={workflow.selectedProjectId}
            onSelectProject={workflow.setSelectedProjectId}
            onSaveRecipe={workflow.saveCurrentAsRecipe}
            onToggleField={workflow.toggleFieldSelection}
            onUpdateField={workflow.updateField}
            onAddField={workflow.addField}
            onRemoveField={workflow.removeField}
            onPaginationChange={(updates) =>
              workflow.setPagination((prev) => ({ ...prev, ...updates }))
            }
            onBack={() => workflow.setView('review_list')}
            onStartHarvest={workflow.startExtraction}
          />
        )}

        {/* 5. Extraction Progress */}
        {workflow.view === 'extracting' && (
          <ExtractionProgressView
            stats={workflow.stats}
            recordWarningThreshold={workflow.recordWarningThreshold}
            onPause={workflow.pauseExtraction}
            onResume={workflow.resumeExtraction}
            onStop={workflow.stopExtraction}
            onCancel={() => void handleCancelExtraction()}
          />
        )}

        {/* 6. Results Data Table */}
        {workflow.view === 'results' && (
          <Suspense fallback={<div className="p-4 text-sm text-slate-500">Loading dataset…</div>}>
            <DataTable
              dataset={workflow.currentDataset}
              records={workflow.records}
              fields={workflow.fields}
              dataRevision={workflow.recordsRevision}
              runSummary={workflow.runSummary}
              onUpdateCell={workflow.updateRecordCell}
              onDeleteRecord={workflow.deleteRecord}
              onRecordsChange={workflow.applyDatasetEdit}
              onNewExtraction={handleNewExtraction}
            />
          </Suspense>
        )}

        {/* 7. Saved Data Library */}
        {workflow.view === 'history' && (
          <Suspense fallback={<div className="p-4 text-sm text-slate-500">Loading history…</div>}>
            <LibraryView
              datasets={datasets}
              isLoading={isDatasetsLoading}
              onViewDataset={handleViewDataset}
              onDeleteDataset={deleteDataset}
              onGetDatasetRecords={getDatasetRecords}
              onNewExtraction={handleNewExtraction}
              onRunRecipe={(recipe) => {
                setActiveTabNav('harvest');
                workflow.loadRecipe(recipe);
              }}
              onUseSchema={(schema) => {
                setActiveTabNav('harvest');
                workflow.loadSchema(schema);
              }}
            />
          </Suspense>
        )}

        {/* 8. Settings */}
        {workflow.view === 'settings' && (
          <Suspense fallback={<div className="p-4 text-sm text-slate-500">Loading settings…</div>}>
            <SettingsView
              onBackToDashboard={() => {
                setActiveTabNav('harvest');
                workflow.setView('dashboard');
              }}
            />
          </Suspense>
        )}
      </main>
    </div>
  );
};

export default App;

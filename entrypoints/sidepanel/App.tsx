import React, { lazy, Suspense, useEffect, useState } from 'react';
import { Wheat, Settings as SettingsIcon, HelpCircle } from 'lucide-react';
import { useActiveTab } from '@/hooks/useActiveTab';
import { useDatasets } from '@/hooks/useDatasets';
import { useExtractionWorkflow } from '@/hooks/useExtractionWorkflow';
import { useOnboarding } from '@/components/guide/useOnboarding';
import { MainDashboard } from '@/components/dashboard/MainDashboard';
import { ErrorBanner } from '@/components/common/ErrorBanner';
import { Stepper } from '@/components/common/Stepper';
import { RecoveryBanner } from '@/components/shell/RecoveryBanner';
import { ScanningState } from '@/components/shell/ScanningState';
import { flowSteps, stepForView, type FlowKind } from '@/components/shell/flow';
import { Button } from '@/components/common/Button';
import { requestSiteOrigin } from '@/platform/permissions';
import type { ConfigStep } from '@/components/picker/FieldSelectionPanel';

// Each step of the flow is its own chunk, so the panel opens on the dashboard alone (ADR-014).
const ElementSelectionBanner = lazy(() =>
  import('@/components/picker/ElementSelectionBanner').then((m) => ({ default: m.ElementSelectionBanner }))
);
const DetectedListPreview = lazy(() =>
  import('@/components/picker/DetectedListPreview').then((m) => ({ default: m.DetectedListPreview }))
);
const FieldSelectionPanel = lazy(() =>
  import('@/components/picker/FieldSelectionPanel').then((m) => ({ default: m.FieldSelectionPanel }))
);
const ExtractionProgressView = lazy(() =>
  import('@/components/dashboard/ExtractionProgressView').then((m) => ({ default: m.ExtractionProgressView }))
);

const DataTable = lazy(() =>
  import('@/components/grid/DataTable').then((module) => ({ default: module.DataTable }))
);
const LibraryView = lazy(() =>
  import('@/components/library/LibraryView').then((module) => ({
    default: module.LibraryView,
  }))
);
// The guide and the tour are only loaded when they open.
const HelpView = lazy(() =>
  import('@/components/guide/HelpView').then((module) => ({ default: module.HelpView }))
);
const Onboarding = lazy(() =>
  import('@/components/guide/Onboarding').then((module) => ({ default: module.Onboarding }))
);
const SettingsView = lazy(() =>
  import('@/components/settings/SettingsView').then((module) => ({ default: module.SettingsView }))
);

type NavSection = 'harvest' | 'datasets' | 'settings' | 'help';

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

  const [activeTabNav, setActiveTabNav] = useState<NavSection>('harvest');
  // How the user started this extraction. It names the stepper's first step; a view reached
  // outside a flow (a saved dataset, a resumed job, the dashboard) shows no stepper.
  const [flow, setFlow] = useState<FlowKind | null>(null);
  const activeFlow = workflow.view === 'dashboard' ? null : flow;
  // Review fields and Pagination share one panel view; this says which half is showing.
  const [configStep, setConfigStep] = useState<ConfigStep>('fields');
  const viewStep = activeFlow ? stepForView(workflow.view) : null;
  const currentStep = viewStep === 'fields' && configStep === 'pagination' ? 'pagination' : viewStep;

  const startFlow = (kind: FlowKind, start: () => void) => {
    setFlow(kind);
    setConfigStep('fields');
    start();
  };

  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const onboarding = useOnboarding();

  const activeSection: NavSection = isHelpOpen
    ? 'help'
    : workflow.view === 'history'
      ? 'datasets'
      : workflow.view === 'settings'
        ? 'settings'
        : activeTabNav;

  // Jobs write datasets from the background, so the list is re-read when the view changes.
  useEffect(() => {
    if (workflow.view === 'dashboard' || workflow.view === 'results') {
      void refreshDatasets();
    }
  }, [workflow.view, refreshDatasets]);

  const handleNavChange = (tabName: Exclude<NavSection, 'help'>) => {
    setIsHelpOpen(false);
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
    setFlow(null);
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

  // Resume asks for the job's site first: chrome.permissions.request must be the first
  // await of the click (ADR-037), and Chrome answers at once, with no prompt, when the
  // site is already granted. If the user declines, the background refuses the resume
  // with SITE_PERMISSION_REQUIRED and the banner offers Allow access again.
  const handleResumeRecoverable = async (jobId: string) => {
    setIsHelpOpen(false);
    setActiveTabNav('harvest');
    setFlow(null);
    const job = workflow.recoverableJobs.find((candidate) => candidate.id === jobId);
    if (job) {
      await requestSiteOrigin(job.targetUrl);
    }
    await workflow.recoverJob(jobId);
  };

  // Allow access for a picking/preview/start SITE error: request first, then
  // clear the banner so the user can retry the flow on the now-granted site.
  const handleAllowAccessForOperationError = async () => {
    const granted = await requestSiteOrigin(tab.url);
    if (granted) {
      workflow.clearOperationError();
    }
  };

  const navButtonClass = (section: NavSection) =>
    `px-2 max-[359px]:px-1.5 py-1 rounded-md font-medium transition-colors ${
      activeSection === section ? 'bg-surface text-brand-emphasis shadow-xs' : 'text-fg-muted hover:text-fg'
    }`;

  return (
    <div className="flex flex-col min-h-screen bg-canvas text-fg">
      {/* Top Header */}
      {/* The side panel opens at about 360px and can be narrowed to 320px, so the header gives
          way in that order: the version badge, then the wordmark (still read out), never the nav. */}
      <header className="sticky top-0 z-30 bg-surface/95 backdrop-blur-xs border-b border-line px-3 py-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 shrink-0 rounded-md bg-brand text-on-strong flex items-center justify-center shadow-xs">
            <Wheat aria-hidden="true" className="w-3.5 h-3.5" />
          </div>
          <div className="flex items-center gap-1.5 min-w-0">
            <h1 className="text-sm font-bold tracking-tight text-fg truncate max-[339px]:sr-only">
              PageHarvest
            </h1>
            <span className="shrink-0 text-2xs font-medium text-fg-subtle bg-surface-muted rounded px-1.5 py-px max-[379px]:hidden">
              v1.0
            </span>
          </div>
        </div>

        {/* Navigation pill switcher */}
        <nav aria-label="Main" className="shrink-0 flex items-center p-0.5 rounded-lg bg-surface-muted border border-line/80 text-xs">
          <button
            type="button"
            onClick={() => handleNavChange('harvest')}
            aria-current={activeSection === 'harvest' ? 'page' : undefined}
            className={navButtonClass('harvest')}
          >
            Harvest
          </button>
          <button
            type="button"
            onClick={() => handleNavChange('datasets')}
            aria-current={activeSection === 'datasets' ? 'page' : undefined}
            className={navButtonClass('datasets')}
          >
            Datasets
          </button>
          <button
            type="button"
            onClick={() => handleNavChange('settings')}
            aria-current={activeSection === 'settings' ? 'page' : undefined}
            aria-label="Settings"
            title="Settings"
            className={navButtonClass('settings')}
          >
            <SettingsIcon aria-hidden="true" className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setIsHelpOpen(true)}
            aria-current={activeSection === 'help' ? 'page' : undefined}
            aria-label="Help"
            title="Help"
            className={navButtonClass('help')}
          >
            <HelpCircle aria-hidden="true" className="w-3.5 h-3.5" />
          </button>
        </nav>
      </header>

      {/* Jobs that can really be resumed: stored in RECOVERABLE with a checkpoint. */}
      {workflow.recoverableJobs.map((job) => (
        <div key={job.id} className="m-3 mb-0">
          <RecoveryBanner
            job={job}
            onResume={(jobId) => void handleResumeRecoverable(jobId)}
            onDiscard={(jobId) => void handleDiscardRecoverable(jobId)}
          />
        </div>
      ))}

      {workflow.operationError && workflow.view !== 'extracting' && (
        <ErrorBanner
          error={workflow.operationError}
          className="m-3 mb-0"
          onDismiss={workflow.clearOperationError}
          actions={
            workflow.operationError.code === 'SITE_PERMISSION_REQUIRED' ? (
              <Button size="sm" onClick={() => void handleAllowAccessForOperationError()}>
                Allow access
              </Button>
            ) : undefined
          }
        />
      )}

      {datasetsError && <ErrorBanner error={{ message: datasetsError }} className="m-3 mb-0" />}

      {!isHelpOpen && activeFlow && currentStep && (
        <Stepper steps={flowSteps(activeFlow)} currentId={currentStep} className="px-4 pt-3" />
      )}

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto flex flex-col">
        {isHelpOpen ? (
          <Suspense fallback={<div className="p-4 text-sm text-fg-subtle">Loading the guide…</div>}>
            <HelpView onClose={() => setIsHelpOpen(false)} onRestartTour={onboarding.open} />
          </Suspense>
        ) : (
        <>
        {/* 1. Main Dashboard */}
        {workflow.view === 'dashboard' && (
          <MainDashboard
            tab={tab}
            isTabLoading={isTabLoading}
            onRefreshTab={refreshTab}
            datasets={datasets}
            isDatasetsLoading={isDatasetsLoading}
            onSelectElements={() => startFlow('pick', workflow.startVisualPicker)}
            onAutoDetectLists={() => startFlow('auto', workflow.autoDetectLists)}
            onExtractTable={() => startFlow('table', () => workflow.startPresetDetection('table'))}
            onExtractLinks={() => startFlow('links', () => workflow.startPresetDetection('links'))}
            onViewDataset={handleViewDataset}
            onViewAllHistory={() => handleNavChange('datasets')}
          />
        )}

        {/* 2. Visual Element Picking State */}
        {workflow.view === 'inspecting' && activeFlow && activeFlow !== 'pick' && (
          <ScanningState kind={activeFlow} onCancel={workflow.resetToDashboard} />
        )}
        {workflow.view === 'inspecting' && (!activeFlow || activeFlow === 'pick') && (
          <Suspense fallback={<div className="p-4 text-sm text-fg-subtle">Loading picker…</div>}>
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
          </Suspense>
        )}

        {/* 3. Detected List Preview */}
        {workflow.view === 'review_list' && workflow.detectedList && (
          <Suspense fallback={<div className="p-4 text-sm text-fg-subtle">Loading lists…</div>}>
            <DetectedListPreview
              detectedList={workflow.detectedList}
              onSelectCandidate={workflow.selectListCandidate}
              onConfirm={() => {
                setConfigStep('fields');
                void workflow.confirmListCandidate(workflow.detectedList!);
              }}
              onPickAgain={() => startFlow('pick', workflow.startVisualPicker)}
              onCancel={workflow.resetToDashboard}
            />
          </Suspense>
        )}

        {/* 4. Field Selection & Pagination Config */}
        {workflow.view === 'config_fields' && workflow.detectedList && (
          <Suspense fallback={<div className="p-4 text-sm text-fg-subtle">Loading fields…</div>}>
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
              onMoveField={workflow.moveField}
              onPreviewFields={workflow.previewFields}
              onPickListAgain={() => startFlow('pick', workflow.startVisualPicker)}
              step={configStep}
              onStepChange={setConfigStep}
              onRemoveField={workflow.removeField}
              onPaginationChange={workflow.updatePagination}
              onBack={() => workflow.setView('review_list')}
              onStartHarvest={workflow.startExtraction}
            />
          </Suspense>
        )}

        {/* 5. Extraction Progress */}
        {workflow.view === 'extracting' && (
          <Suspense fallback={<div className="p-4 text-sm text-fg-subtle">Loading progress…</div>}>
            <ExtractionProgressView
              stats={workflow.stats}
              recordWarningThreshold={workflow.recordWarningThreshold}
              onPause={workflow.pauseExtraction}
              onResume={workflow.resumeExtraction}
              onStop={workflow.stopExtraction}
              onCancel={() => void handleCancelExtraction()}
            />
          </Suspense>
        )}

        {/* 6. Results Data Table */}
        {workflow.view === 'results' && (
          <Suspense fallback={<div className="p-4 text-sm text-fg-subtle">Loading dataset…</div>}>
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
          <Suspense fallback={<div className="p-4 text-sm text-fg-subtle">Loading history…</div>}>
            <LibraryView
              datasets={datasets}
              isLoading={isDatasetsLoading}
              onViewDataset={handleViewDataset}
              onDeleteDataset={deleteDataset}
              onGetDatasetRecords={getDatasetRecords}
              onNewExtraction={handleNewExtraction}
              onRunRecipe={(recipe) => {
                setActiveTabNav('harvest');
                setFlow('recipe');
                setConfigStep('fields');
                workflow.loadRecipe(recipe);
              }}
              onUseSchema={(schema) => {
                setActiveTabNav('harvest');
                setFlow('recipe');
                setConfigStep('fields');
                workflow.loadSchema(schema);
              }}
            />
          </Suspense>
        )}

        {/* 8. Settings */}
        {workflow.view === 'settings' && (
          <Suspense fallback={<div className="p-4 text-sm text-fg-subtle">Loading settings…</div>}>
            <SettingsView
              onBackToDashboard={() => {
                setActiveTabNav('harvest');
                workflow.setView('dashboard');
              }}
            />
          </Suspense>
        )}
        </>
        )}
      </main>

      {onboarding.isOpen && (
        <Suspense fallback={null}>
          <Onboarding onFinish={onboarding.finish} />
        </Suspense>
      )}
    </div>
  );
};

export default App;

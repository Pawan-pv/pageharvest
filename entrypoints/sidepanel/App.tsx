import React, { lazy, Suspense, useEffect, useState } from 'react';
import { Wheat, Settings as SettingsIcon, HelpCircle } from 'lucide-react';
import { useActiveTab } from '@/hooks/useActiveTab';
import { useDatasets } from '@/hooks/useDatasets';
import { useExtractionWorkflow, type DetectedList } from '@/hooks/useExtractionWorkflow';
import type { ListCandidate } from '@/shared/contracts/message';
import { useOnboarding } from '@/components/guide/useOnboarding';
import { useConsent } from '@/components/consent/useConsent';
import { useAdvancedMode } from '@/components/settings/useAdvancedMode';
import { MainDashboard } from '@/components/dashboard/MainDashboard';
import { Stepper } from '@/components/common/Stepper';
import { ScanningState } from '@/components/shell/ScanningState';
import { flowSteps, simpleFlowSteps, stepForView, type FlowKind } from '@/components/shell/flow';
import { Banner } from '@/components/common/Banner';
import { Button } from '@/components/common/Button';
import { requestSiteOrigin } from '@/platform/permissions';
import { simpleStartingPagination } from '@/components/simple/more-pages';
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
const ConsentGate = lazy(() =>
  import('@/components/consent/ConsentGate').then((module) => ({ default: module.ConsentGate }))
);
const SettingsView = lazy(() =>
  import('@/components/settings/SettingsView').then((module) => ({ default: module.SettingsView }))
);
// Simple mode's first step: picking, choosing a list, and "We found N items" (ADR-039).
const SimplePicking = lazy(() =>
  import('@/components/simple/FindList').then((module) => ({ default: module.SimplePicking }))
);
const SimpleListChooser = lazy(() =>
  import('@/components/simple/FindList').then((module) => ({ default: module.SimpleListChooser }))
);
const SimpleListCheck = lazy(() =>
  import('@/components/simple/FindList').then((module) => ({ default: module.SimpleListCheck }))
);
// The rest of simple mode: columns and more pages, progress, the Done screen and My data.
const SimpleColumns = lazy(() =>
  import('@/components/simple/Columns').then((module) => ({ default: module.SimpleColumns }))
);
const SimpleProgress = lazy(() =>
  import('@/components/simple/Progress').then((module) => ({ default: module.SimpleProgress }))
);
const SimpleDone = lazy(() => import('@/components/simple/Done').then((module) => ({ default: module.SimpleDone })));
const SimpleMyData = lazy(() =>
  import('@/components/simple/MyData').then((module) => ({ default: module.SimpleMyData }))
);
// Shown only when the user switches tabs with a list found, so it is not in the opening chunk.
const ListOnAnotherTab = lazy(() =>
  import('@/components/shell/ListOnAnotherTab').then((module) => ({ default: module.ListOnAnotherTab }))
);
// Shown only after an interruption or an error, so neither is in the chunk every open pays for.
const RecoveryBanner = lazy(() =>
  import('@/components/shell/RecoveryBanner').then((module) => ({ default: module.RecoveryBanner }))
);
const ErrorBanner = lazy(() =>
  import('@/components/common/ErrorBanner').then((module) => ({ default: module.ErrorBanner }))
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
  // Simple mode is the default; Advanced options brings the detailed controls back (ADR-039).
  const { advanced } = useAdvancedMode();

  const [activeTabNav, setActiveTabNav] = useState<NavSection>('harvest');
  // How the user started this extraction. It names the stepper's first step; a view reached
  // outside a flow (a saved dataset, a resumed job, the dashboard) shows no stepper.
  const [flow, setFlow] = useState<FlowKind | null>(null);
  const activeFlow = workflow.view === 'dashboard' ? null : flow;
  // Review fields and Pagination share one panel view; this says which half is showing.
  const [configStep, setConfigStep] = useState<ConfigStep>('fields');
  // Simple mode shows the columns view in two halves: "We found N items", then the columns.
  const [simpleStage, setSimpleStage] = useState<'check' | 'columns'>('check');
  // The user asked for the other lists, so the best match is not accepted for them.
  const [choosingList, setChoosingList] = useState(false);
  // The list simple mode last accepted by itself, so a failure is not retried in a loop.
  const [acceptedList, setAcceptedList] = useState<DetectedList | null>(null);
  // Simple mode ends on a summary; the full table is opened from it.
  const [showAllRows, setShowAllRows] = useState(false);
  // The rows on screen were opened from saved data, not collected just now.
  const [openedSavedData, setOpenedSavedData] = useState(false);
  const viewStep = activeFlow ? stepForView(workflow.view) : null;
  const currentStep = advanced
    ? viewStep === 'fields' && configStep === 'pagination'
      ? 'pagination'
      : viewStep
    : viewStep === 'fields' && simpleStage === 'check'
      ? 'pick'
      : viewStep;

  const startFlow = (kind: FlowKind, start: () => void) => {
    setFlow(kind);
    setConfigStep('fields');
    setSimpleStage('check');
    setChoosingList(false);
    setShowAllRows(false);
    setOpenedSavedData(false);
    start();
  };

  // In simple mode a list that looks like data is accepted without a choosing screen: the
  // next screen shows its first rows and asks "is this it?". A list that looks like a menu,
  // or one whose columns could not be read, is never accepted for the user.
  const { view: workflowView, detectedList, confirmListCandidate, updatePagination } = workflow;
  const acceptsListForUser =
    !advanced &&
    workflowView === 'review_list' &&
    !choosingList &&
    detectedList !== null &&
    detectedList.credible !== false &&
    detectedList.matchCount > 0 &&
    acceptedList !== detectedList;
  useEffect(() => {
    if (!acceptsListForUser || !detectedList) return;
    setAcceptedList(detectedList);
    setSimpleStage('check');
    // Follow the list when the page shows a way to more of it; otherwise just this page.
    updatePagination(simpleStartingPagination(detectedList.moreItems));
    void confirmListCandidate(detectedList);
  }, [acceptsListForUser, detectedList, confirmListCandidate, updatePagination]);

  const handleUseCandidate = (candidate: ListCandidate) => {
    const chosen: DetectedList = {
      ...(workflow.detectedList ?? { sampleSnippets: [] }),
      containerSelector: candidate.containerSelector,
      containerAnchor: candidate.containerAnchor,
      matchCount: candidate.matchCount,
      sampleSnippets: candidate.sampleSnippets,
      kind: candidate.kind,
      dedupeFields: candidate.dedupeFields,
    };
    setAcceptedList(chosen);
    setChoosingList(false);
    setSimpleStage('check');
    workflow.updatePagination(simpleStartingPagination(chosen.moreItems));
    void workflow.confirmListCandidate(chosen);
  };

  // A saved setup is an Advanced feature; when one is loaded, its detailed screen is shown as it is.
  const simpleColumnsFlow = !advanced && flow !== 'recipe';
  const showsSimpleCheck = simpleColumnsFlow && simpleStage === 'check';
  const showsSimpleColumns = simpleColumnsFlow && simpleStage === 'columns';
  const showsDetailedColumns = !simpleColumnsFlow;

  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const consent = useConsent();
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
    setShowAllRows(false);
    setOpenedSavedData(true);
    workflow.viewDatasetInTable(dataset);
  };

  const handleNewExtraction = () => {
    setActiveTabNav('harvest');
    setShowAllRows(false);
    setOpenedSavedData(false);
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
    setShowAllRows(false);
    setOpenedSavedData(false);
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

  if (consent.hasConsent === false) {
    return (
      <div className="flex flex-col h-screen w-full bg-surface text-fg font-sans antialiased overflow-hidden">
        <Suspense fallback={<div className="p-4 text-xs text-fg-subtle">Loading…</div>}>
          <ConsentGate onAccept={consent.accept} />
        </Suspense>
      </div>
    );
  }

  if (consent.hasConsent === null) {
    return <div className="flex h-screen w-full bg-surface" />;
  }

  return (
    <div className="flex flex-col min-h-screen bg-canvas text-fg">
      {/* Top Header */}
      {/* The side panel opens at about 360px and can be narrowed to 320px, so at the narrowest
          the wordmark gives way (it is still read out), never the nav. The version is in Help. */}
      <header className="sticky top-0 z-30 bg-surface/95 backdrop-blur-xs border-b border-line px-3 py-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 shrink-0 rounded-md bg-brand text-on-strong flex items-center justify-center shadow-xs">
            <Wheat aria-hidden="true" className="w-3.5 h-3.5" />
          </div>
          <h1 className="text-sm font-bold tracking-tight text-fg truncate max-[339px]:sr-only">PageHarvest</h1>
        </div>

        {/* Navigation pill switcher */}
        <nav aria-label="Main" className="shrink-0 flex items-center p-0.5 rounded-lg bg-surface-muted border border-line/80 text-xs">
          <button
            type="button"
            onClick={() => handleNavChange('harvest')}
            aria-current={activeSection === 'harvest' ? 'page' : undefined}
            className={navButtonClass('harvest')}
          >
            Get data
          </button>
          <button
            type="button"
            onClick={() => handleNavChange('datasets')}
            aria-current={activeSection === 'datasets' ? 'page' : undefined}
            className={navButtonClass('datasets')}
          >
            My data
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
      <Suspense fallback={null}>
        {workflow.recoverableJobs.map((job) => (
          <div key={job.id} className="m-3 mb-0">
            <RecoveryBanner
              job={job}
              simple={!advanced}
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
      </Suspense>

      {!isHelpOpen && activeFlow && currentStep && (
        <Stepper
          steps={advanced ? flowSteps(activeFlow) : simpleFlowSteps(activeFlow)}
          currentId={currentStep}
          className="px-4 pt-3"
        />
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
        {workflow.view === 'dashboard' && workflow.notice && (
          <Banner tone="info" className="m-3 mb-0" onDismiss={workflow.clearNotice}>
            {workflow.notice}
          </Banner>
        )}
        {workflow.view === 'dashboard' && (
          <MainDashboard
            tab={tab}
            isTabLoading={isTabLoading}
            onRefreshTab={refreshTab}
            datasets={datasets}
            isDatasetsLoading={isDatasetsLoading}
            advanced={advanced}
            onSelectElements={() => startFlow('pick', workflow.startVisualPicker)}
            onAutoDetectLists={() => startFlow('auto', workflow.autoDetectLists)}
            onExtractTable={() => startFlow('table', () => workflow.startPresetDetection('table'))}
            onExtractLinks={() => startFlow('links', () => workflow.startPresetDetection('links'))}
            onViewDataset={handleViewDataset}
            onViewAllHistory={() => handleNavChange('datasets')}
          />
        )}

        {/* A list found on a tab that is not in front: go back to it, or start again here. */}
        {workflow.listElsewhere && workflow.listSource && (
          <Suspense fallback={<div className="p-4 text-sm text-fg-subtle">Loading…</div>}>
            <ListOnAnotherTab
              source={workflow.listSource}
              onGoBack={() => void workflow.goBackToListTab()}
              onStartOver={handleNewExtraction}
            />
          </Suspense>
        )}

        {/* 2. Visual Element Picking State */}
        {workflow.view === 'inspecting' && !workflow.listElsewhere && activeFlow && activeFlow !== 'pick' && (
          <ScanningState kind={activeFlow} onCancel={workflow.resetToDashboard} />
        )}
        {workflow.view === 'inspecting' && !workflow.listElsewhere && (!activeFlow || activeFlow === 'pick') && !advanced && (
          <Suspense fallback={<div className="p-4 text-sm text-fg-subtle">Loading…</div>}>
            <SimplePicking inspectedElement={workflow.inspectedElement} onCancel={workflow.cancelVisualPicker} />
          </Suspense>
        )}
        {workflow.view === 'inspecting' && !workflow.listElsewhere && (!activeFlow || activeFlow === 'pick') && advanced && (
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
        {workflow.view === 'review_list' && !workflow.listElsewhere && workflow.detectedList && !advanced && acceptsListForUser && (
          <ScanningState kind={activeFlow ?? 'auto'} onCancel={workflow.resetToDashboard} />
        )}
        {workflow.view === 'review_list' && !workflow.listElsewhere && workflow.detectedList && !advanced && !acceptsListForUser && (
          <Suspense fallback={<div className="p-4 text-sm text-fg-subtle">Loading lists…</div>}>
            <SimpleListChooser
              detectedList={workflow.detectedList}
              onUse={handleUseCandidate}
              onPickMyself={() => startFlow('pick', workflow.startVisualPicker)}
              onCancel={workflow.resetToDashboard}
            />
          </Suspense>
        )}
        {workflow.view === 'review_list' && !workflow.listElsewhere && workflow.detectedList && advanced && (
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
        {workflow.view === 'config_fields' && !workflow.listElsewhere && workflow.detectedList && showsSimpleCheck && (
          <Suspense fallback={<div className="p-4 text-sm text-fg-subtle">Loading your list…</div>}>
            <SimpleListCheck
              detectedList={workflow.detectedList}
              columns={workflow.fields.filter((field) => workflow.selectedFieldIds.has(field.id))}
              onPreviewFields={workflow.previewFields}
              onConfirm={() => setSimpleStage('columns')}
              onChooseAnother={() => {
                setChoosingList(true);
                workflow.setView('review_list');
              }}
              onCancel={workflow.resetToDashboard}
            />
          </Suspense>
        )}
        {workflow.view === 'config_fields' && !workflow.listElsewhere && workflow.detectedList && showsSimpleColumns && (
          <Suspense fallback={<div className="p-4 text-sm text-fg-subtle">Loading columns…</div>}>
            <SimpleColumns
              detectedList={workflow.detectedList}
              fields={workflow.fields}
              selectedFieldIds={workflow.selectedFieldIds}
              pagination={workflow.pagination}
              onToggleField={workflow.toggleFieldSelection}
              onRenameField={(id, name) => workflow.updateField(id, { name })}
              onPaginationChange={workflow.updatePagination}
              onBack={() => setSimpleStage('check')}
              onStart={workflow.startExtraction}
            />
          </Suspense>
        )}
        {workflow.view === 'config_fields' && !workflow.listElsewhere && workflow.detectedList && showsDetailedColumns && (
          <Suspense fallback={<div className="p-4 text-sm text-fg-subtle">Loading columns…</div>}>
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
        {workflow.view === 'extracting' && !advanced && (
          <Suspense fallback={<div className="p-4 text-sm text-fg-subtle">Loading progress…</div>}>
            <SimpleProgress
              stats={workflow.stats}
              onPause={workflow.pauseExtraction}
              onResume={workflow.resumeExtraction}
              onStop={workflow.stopExtraction}
              onClose={() => void handleCancelExtraction()}
            />
          </Suspense>
        )}
        {workflow.view === 'extracting' && advanced && (
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
        {workflow.view === 'results' && !advanced && !showAllRows && (
          <Suspense fallback={<div className="p-4 text-sm text-fg-subtle">Loading your rows…</div>}>
            <SimpleDone
              dataset={workflow.currentDataset}
              records={workflow.records}
              fields={workflow.fields}
              justFinished={!openedSavedData}
              runSummary={workflow.runSummary}
              onOpenTable={() => setShowAllRows(true)}
              onNewExtraction={handleNewExtraction}
            />
          </Suspense>
        )}
        {workflow.view === 'results' && (advanced || showAllRows) && (
          <Suspense fallback={<div className="p-4 text-sm text-fg-subtle">Loading your rows…</div>}>
            <DataTable
              simple={!advanced}
              onBack={() => setShowAllRows(false)}
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
        {workflow.view === 'history' && !advanced && (
          <Suspense fallback={<div className="p-4 text-sm text-fg-subtle">Loading your data…</div>}>
            <SimpleMyData
              datasets={datasets}
              isLoading={isDatasetsLoading}
              onViewDataset={handleViewDataset}
              onDeleteDataset={deleteDataset}
              onGetDatasetRecords={getDatasetRecords}
              onNewExtraction={handleNewExtraction}
            />
          </Suspense>
        )}
        {workflow.view === 'history' && advanced && (
          <Suspense fallback={<div className="p-4 text-sm text-fg-subtle">Loading your data…</div>}>
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
                setSimpleStage('columns');
                workflow.loadRecipe(recipe);
              }}
              onUseSchema={(schema) => {
                setActiveTabNav('harvest');
                setFlow('recipe');
                setConfigStep('fields');
                setSimpleStage('columns');
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

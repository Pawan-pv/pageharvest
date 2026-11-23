import React, { lazy, Suspense, useEffect, useState } from 'react';
import {
  Bookmark,
  Database,
  HelpCircle,
  MousePointer2,
  Settings as SettingsIcon,
  Wheat,
  Wrench,
} from 'lucide-react';
import { useActiveTab } from '@/hooks/useActiveTab';
import { useDatasets } from '@/hooks/useDatasets';
import { useExtractionWorkflow, type DetectedList } from '@/hooks/useExtractionWorkflow';
import type { ListCandidate } from '@/shared/contracts/message';
import { useOnboarding } from '@/components/guide/useOnboarding';
import { useConsent } from '@/components/consent/useConsent';
import { useAdvancedMode } from '@/components/settings/useAdvancedMode';
import { MainDashboard } from '@/components/dashboard/MainDashboard';
import { WebsiteCard } from '@/components/dashboard/WebsiteCard';
import { Stepper } from '@/components/common/Stepper';
import { ScanningState } from '@/components/shell/ScanningState';
import { flowSteps, simpleFlowSteps, stepForView, type FlowKind } from '@/components/shell/flow';
import { Banner } from '@/components/common/Banner';
import { Button } from '@/components/common/Button';
import { requestSiteOrigin } from '@/platform/permissions';
import { openWorkbench } from '@/platform/workbench';
import { simpleStartingPagination } from '@/components/simple/more-pages';
import type { ConfigStep } from '@/components/picker/FieldSelectionPanel';
import type { ExtractionRecipe } from '@/types';

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
const RecipesPanel = lazy(() =>
  import('@/components/library/LibraryView').then((module) => ({
    default: module.RecipesPanel,
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

const SitemapExplorerView = lazy(() =>
  import('@/components/tools/SitemapExplorerView').then((module) => ({ default: module.SitemapExplorerView }))
);
const PageExtractorView = lazy(() =>
  import('@/components/tools/PageExtractorView').then((module) => ({ default: module.PageExtractorView }))
);
const ShopifyExtractorView = lazy(() =>
  import('@/components/tools/ShopifyExtractorView').then((module) => ({ default: module.ShopifyExtractorView }))
);
const EmailExtractorView = lazy(() =>
  import('@/components/tools/EmailExtractorView').then((module) => ({ default: module.EmailExtractorView }))
);
const SocialExtractorView = lazy(() =>
  import('@/components/tools/SocialExtractorView').then((module) => ({ default: module.SocialExtractorView }))
);
const PageTextExtractorView = lazy(() =>
  import('@/components/tools/PageTextExtractorView').then((module) => ({ default: module.PageTextExtractorView }))
);
const ImageDownloaderView = lazy(() =>
  import('@/components/tools/ImageDownloaderView').then((module) => ({ default: module.ImageDownloaderView }))
);

/** The three destinations in the command dock. Help and Settings are icon buttons above it. */
type NavSection = 'tools' | 'datasets' | 'recipes';
type ActiveSection = NavSection | 'settings' | 'help';

const ViewSkeleton: React.FC<{ label?: string }> = ({ label = 'Loading…' }) => (
  <div className="p-4 space-y-3 animate-pulse" role="status" aria-label={label}>
    <div className="h-4 bg-surface-muted rounded-md w-2/3" />
    <div className="h-9 bg-surface-muted rounded-md w-full" />
    <div className="h-20 bg-surface-muted rounded-md w-full" />
    <span className="sr-only">{label}</span>
  </div>
);

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

  const [activeTabNav, setActiveTabNav] = useState<NavSection>('tools');
  // How the user started this extraction. It names the stepper's first step; a view reached
  // outside a flow (a saved dataset, a resumed job, the dashboard) shows no stepper.
  const [flow, setFlow] = useState<FlowKind | null>(null);
  const [activeToolView, setActiveToolView] = useState<
    'page' | 'sitemap' | 'shopify' | 'email' | 'social' | 'page_text' | 'images' | null
  >(null);
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
    setActiveToolView(null);
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

  const activeSection: ActiveSection = isHelpOpen
    ? 'help'
    : workflow.view === 'settings'
      ? 'settings'
      : workflow.view === 'history'
        ? activeTabNav === 'tools'
          ? 'datasets'
          : activeTabNav
        : activeTabNav;

  // Jobs write datasets from the background, so the list is re-read when the view changes.
  useEffect(() => {
    if (workflow.view === 'dashboard' || workflow.view === 'results') {
      void refreshDatasets();
    }
  }, [workflow.view, refreshDatasets]);

  const handleNavChange = (section: NavSection) => {
    setIsHelpOpen(false);
    setActiveToolView(null);
    setActiveTabNav(section);
    if (section === 'datasets' || section === 'recipes') {
      workflow.setView('history');
      void refreshDatasets();
    } else if (workflow.view === 'history' || workflow.view === 'settings') {
      workflow.setView('dashboard');
    }
  };

  const handleOpenSettings = () => {
    setIsHelpOpen(false);
    setActiveToolView(null);
    setActiveTabNav('tools');
    workflow.setView('settings');
  };

  const handleViewDataset = (dataset: (typeof datasets)[0]) => {
    setActiveTabNav('tools');
    setActiveToolView(null);
    setFlow(null);
    setShowAllRows(false);
    setOpenedSavedData(true);
    workflow.viewDatasetInTable(dataset);
  };

  const handleNewExtraction = () => {
    setActiveTabNav('tools');
    setActiveToolView(null);
    setShowAllRows(false);
    setOpenedSavedData(false);
    workflow.resetToDashboard();
    void refreshDatasets();
  };

  const handleRunRecipe = (recipe: ExtractionRecipe) => {
    setActiveTabNav('tools');
    setActiveToolView(null);
    setFlow('recipe');
    setConfigStep('fields');
    setSimpleStage('columns');
    workflow.loadRecipe(recipe);
  };

  const handleCancelExtraction = async () => {
    await workflow.cancelExtraction();
    void refreshDatasets();
  };

  const handleDiscardRecoverable = async (jobId: string) => {
    await workflow.discardRecoverableJob(jobId);
    void refreshDatasets();
  };

  // Resume asks for the job's site first: chrome.permissions.request must be the first
  // await of the click (ADR-037), and Chrome answers at once, with no prompt, when the
  // site is already granted. If the user declines, the background refuses the resume
  // with SITE_PERMISSION_REQUIRED and the banner offers Allow access again.
  const handleResumeRecoverable = async (jobId: string) => {
    setIsHelpOpen(false);
    setActiveTabNav('tools');
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

  const navPillClass = (section: NavSection) =>
    `flex min-h-8 items-center gap-1 rounded-xl px-2 text-xs font-semibold transition-colors ${
      activeSection === section
        ? 'bg-surface-muted text-fg shadow-xs'
        : 'text-fg-subtle hover:bg-surface hover:text-fg'
    }`;

  const iconButtonClass = (active: boolean) =>
    `flex h-9 w-9 items-center justify-center rounded-xl border transition-colors ${
      active
        ? 'border-tool-emerald/40 bg-tool-emerald/10 text-tool-emerald'
        : 'border-hairline/10 bg-dock text-fg-muted hover:border-hairline/25 hover:text-fg'
    }`;

  if (consent.hasConsent === false) {
    return (
      <div className="flex flex-col h-screen w-full bg-canvas text-fg font-sans antialiased overflow-hidden">
        <Suspense fallback={<ViewSkeleton label="Loading…" />}>
          <ConsentGate onAccept={consent.accept} />
        </Suspense>
      </div>
    );
  }

  if (consent.hasConsent === null) {
    return <div className="flex h-screen w-full bg-canvas" />;
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas font-sans text-fg antialiased">
      <main className="flex-1 overflow-y-auto px-3.5 pb-6">
        {/* Top brand row: scrolls with the page, so it never sits over the active-page strip. */}
        <div className="flex items-center justify-between gap-2 pb-2 pt-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-tool-emerald to-tool-teal text-on-accent shadow-xs">
              <Wheat aria-hidden="true" className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-[15px] font-bold tracking-tight text-fg">PageHarvest</h1>
              <p className="truncate text-2xs text-fg-subtle">Local data extraction, simplified</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setIsHelpOpen(true)}
              aria-label="Help"
              title="Help"
              aria-current={activeSection === 'help' ? 'page' : undefined}
              className={iconButtonClass(activeSection === 'help')}
            >
              <HelpCircle aria-hidden="true" className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleOpenSettings}
              aria-label="Settings"
              title="Settings"
              aria-current={activeSection === 'settings' ? 'page' : undefined}
              className={iconButtonClass(activeSection === 'settings')}
            >
              <SettingsIcon aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Sticky command dock: the picker is always one click away, and navigation never scrolls off. */}
        <div className="sticky top-2 z-20 mb-2 rounded-2xl border border-hairline/10 bg-dock-solid/95 p-1.5 shadow-lg backdrop-blur-md">
          <div className="flex items-center justify-between gap-1.5">
            <button
              type="button"
              onClick={() => startFlow('pick', workflow.startVisualPicker)}
              disabled={!tab.isInjectable}
              title="Pick element on page"
              aria-label="Pick element on page"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-tool-emerald/50 bg-tool-emerald/10 text-tool-emerald transition-colors hover:bg-tool-emerald/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <MousePointer2 aria-hidden="true" className="h-4 w-4" />
            </button>

            <nav aria-label="Main" className="flex min-w-0 items-center gap-0.5">
              <button
                type="button"
                onClick={() => handleNavChange('tools')}
                aria-current={activeSection === 'tools' ? 'page' : undefined}
                className={navPillClass('tools')}
              >
                <Wrench aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                Tools
              </button>
              <button
                type="button"
                onClick={() => handleNavChange('datasets')}
                aria-current={activeSection === 'datasets' ? 'page' : undefined}
                className={navPillClass('datasets')}
              >
                <Database aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                Data
                {datasets.length > 0 && (
                  <span
                    aria-hidden="true"
                    className="rounded-full bg-surface px-1.5 py-0.5 text-2xs font-bold tabular-nums text-fg-subtle"
                  >
                    {datasets.length}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => handleNavChange('recipes')}
                aria-current={activeSection === 'recipes' ? 'page' : undefined}
                className={navPillClass('recipes')}
              >
                <Bookmark aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                Recipes
              </button>
            </nav>
          </div>
        </div>

        {/* Compact active-page context, directly under the dock. */}
        <div className="mb-2">
          <WebsiteCard
            tab={tab}
            isLoading={isTabLoading}
            advanced={advanced}
            onRefresh={refreshTab}
            onOpenShopify={() => setActiveToolView('shopify')}
          />
        </div>

        {/* Jobs that can really be resumed: stored in RECOVERABLE with a checkpoint. */}
        <Suspense fallback={null}>
          {workflow.recoverableJobs.map((job) => (
            <div key={job.id} className="mb-2">
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
              className="mb-2"
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

          {datasetsError && <ErrorBanner error={{ message: datasetsError }} className="mb-2" />}
        </Suspense>

        {!isHelpOpen && activeFlow && currentStep && (
          <Stepper
            steps={advanced ? flowSteps(activeFlow) : simpleFlowSteps(activeFlow)}
            currentId={currentStep}
            className="pb-2"
          />
        )}

        {/* Main Content Area */}
        <div>
          {isHelpOpen ? (
            <Suspense fallback={<ViewSkeleton label="Loading the guide…" />}>
              <HelpView onClose={() => setIsHelpOpen(false)} onRestartTour={onboarding.open} />
            </Suspense>
          ) : activeToolView === 'page' ? (
            <Suspense fallback={<ViewSkeleton label="Loading Page Extractor…" />}>
              <PageExtractorView
                onBack={() => setActiveToolView(null)}
                onOpenTable={(datasetId) => {
                  setActiveToolView(null);
                  void openWorkbench({ datasetId });
                }}
              />
            </Suspense>
          ) : activeToolView === 'sitemap' ? (
            <Suspense fallback={<ViewSkeleton label="Loading Sitemap Explorer…" />}>
              <SitemapExplorerView
                initialUrl={tab.url}
                onBack={() => setActiveToolView(null)}
                onSendUrlsToTool={() => setActiveToolView('page')}
              />
            </Suspense>
          ) : activeToolView === 'shopify' ? (
            <Suspense fallback={<ViewSkeleton label="Loading Shopify Extractor…" />}>
              <ShopifyExtractorView
                initialUrl={tab.url}
                onBack={() => setActiveToolView(null)}
                onOpenTable={(datasetId) => {
                  setActiveToolView(null);
                  void openWorkbench({ datasetId });
                }}
              />
            </Suspense>
          ) : activeToolView === 'email' ? (
            <Suspense fallback={<ViewSkeleton label="Loading Email Extractor…" />}>
              <EmailExtractorView
                onBack={() => setActiveToolView(null)}
                onOpenTable={(datasetId) => {
                  setActiveToolView(null);
                  void openWorkbench({ datasetId });
                }}
              />
            </Suspense>
          ) : activeToolView === 'social' ? (
            <Suspense fallback={<ViewSkeleton label="Loading Social Link Extractor…" />}>
              <SocialExtractorView
                onBack={() => setActiveToolView(null)}
                onOpenTable={(datasetId) => {
                  setActiveToolView(null);
                  void openWorkbench({ datasetId });
                }}
              />
            </Suspense>
          ) : activeToolView === 'page_text' ? (
            <Suspense fallback={<ViewSkeleton label="Loading Page Text Extractor…" />}>
              <PageTextExtractorView
                onBack={() => setActiveToolView(null)}
                onOpenTable={(datasetId) => {
                  setActiveToolView(null);
                  void openWorkbench({ datasetId });
                }}
              />
            </Suspense>
          ) : activeToolView === 'images' ? (
            <Suspense fallback={<ViewSkeleton label="Loading Image Downloader…" />}>
              <ImageDownloaderView
                onBack={() => setActiveToolView(null)}
                onOpenTable={(datasetId) => {
                  setActiveToolView(null);
                  void openWorkbench({ datasetId });
                }}
              />
            </Suspense>
          ) : (
            <>
              {/* 1. Main Dashboard */}
              {workflow.view === 'dashboard' && workflow.notice && (
                <Banner tone="info" className="mb-2" onDismiss={workflow.clearNotice}>
                  {workflow.notice}
                </Banner>
              )}
              {workflow.view === 'dashboard' && (
                <MainDashboard
                  datasets={datasets}
                  disabled={!tab.isInjectable}
                  onAutoDetectLists={() => startFlow('auto', workflow.autoDetectLists)}
                  onExtractTable={() => startFlow('table', () => workflow.startPresetDetection('table'))}
                  onExtractLinks={() => startFlow('links', () => workflow.startPresetDetection('links'))}
                  onOpenPageExtractor={() => setActiveToolView('page')}
                  onOpenSitemapExplorer={() => setActiveToolView('sitemap')}
                  onOpenShopifyExtractor={() => setActiveToolView('shopify')}
                  onOpenEmailExtractor={() => setActiveToolView('email')}
                  onOpenSocialExtractor={() => setActiveToolView('social')}
                  onOpenPageTextExtractor={() => setActiveToolView('page_text')}
                  onOpenImageDownloader={() => setActiveToolView('images')}
                  onViewAllHistory={() => handleNavChange('datasets')}
                />
              )}

              {/* A list found on a tab that is not in front: go back to it, or start again here. */}
              {workflow.listElsewhere && workflow.listSource && (
                <Suspense fallback={<ViewSkeleton label="Loading…" />}>
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
                <Suspense fallback={<ViewSkeleton label="Loading…" />}>
                  <SimplePicking inspectedElement={workflow.inspectedElement} onCancel={workflow.cancelVisualPicker} />
                </Suspense>
              )}
              {workflow.view === 'inspecting' && !workflow.listElsewhere && (!activeFlow || activeFlow === 'pick') && advanced && (
                <Suspense fallback={<ViewSkeleton label="Loading picker…" />}>
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
                <Suspense fallback={<ViewSkeleton label="Loading lists…" />}>
                  <SimpleListChooser
                    detectedList={workflow.detectedList}
                    onUse={handleUseCandidate}
                    onPickMyself={() => startFlow('pick', workflow.startVisualPicker)}
                    onCancel={workflow.resetToDashboard}
                  />
                </Suspense>
              )}
              {workflow.view === 'review_list' && !workflow.listElsewhere && workflow.detectedList && advanced && (
                <Suspense fallback={<ViewSkeleton label="Loading lists…" />}>
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
                <Suspense fallback={<ViewSkeleton label="Loading your list…" />}>
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
                <Suspense fallback={<ViewSkeleton label="Loading columns…" />}>
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
                <Suspense fallback={<ViewSkeleton label="Loading columns…" />}>
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
                <Suspense fallback={<ViewSkeleton label="Loading progress…" />}>
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
                <Suspense fallback={<ViewSkeleton label="Loading progress…" />}>
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
                <Suspense fallback={<ViewSkeleton label="Loading your rows…" />}>
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
                <Suspense fallback={<ViewSkeleton label="Loading your rows…" />}>
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
                    onOpenTool={(tool) => {
                      if (
                        tool === 'page' ||
                        tool === 'sitemap' ||
                        tool === 'shopify' ||
                        tool === 'email' ||
                        tool === 'social' ||
                        tool === 'page_text' ||
                        tool === 'images'
                      ) {
                        setActiveToolView(tool);
                      } else {
                        void openWorkbench({ tool });
                      }
                    }}
                  />
                </Suspense>
              )}

              {/* 7. Saved Data Library */}
              {workflow.view === 'history' && activeTabNav === 'recipes' && (
                <div className="flex flex-col gap-3 p-4 text-left">
                  <div>
                    <h2 className="text-base font-semibold text-fg">Saved Recipes</h2>
                    <p className="mt-1 text-body text-fg-muted">Run a saved setup again on the page it was made for.</p>
                  </div>
                  <Suspense fallback={<ViewSkeleton label="Loading recipes…" />}>
                    <RecipesPanel onRunRecipe={handleRunRecipe} onNewExtraction={handleNewExtraction} />
                  </Suspense>
                </div>
              )}
              {workflow.view === 'history' && activeTabNav !== 'recipes' && !advanced && (
                <Suspense fallback={<ViewSkeleton label="Loading your data…" />}>
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
              {workflow.view === 'history' && activeTabNav !== 'recipes' && advanced && (
                <Suspense fallback={<ViewSkeleton label="Loading your data…" />}>
                  <LibraryView
                    datasets={datasets}
                    isLoading={isDatasetsLoading}
                    onViewDataset={handleViewDataset}
                    onDeleteDataset={deleteDataset}
                    onGetDatasetRecords={getDatasetRecords}
                    onNewExtraction={handleNewExtraction}
                    onRunRecipe={handleRunRecipe}
                    onUseSchema={(schema) => {
                      setActiveTabNav('tools');
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
                <Suspense fallback={<ViewSkeleton label="Loading settings…" />}>
                  <SettingsView
                    onBackToDashboard={() => {
                      setActiveTabNav('tools');
                      workflow.setView('dashboard');
                    }}
                  />
                </Suspense>
              )}
            </>
          )}
        </div>
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

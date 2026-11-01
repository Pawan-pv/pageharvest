import React, { useEffect, useState } from 'react';
import { getActiveTab, getTabStatus, TabStatus, TabManager } from '@/platform/tab-manager';
import { recoverJobState, clearJobState, JobStateSnapshot } from '@/platform/job-recovery';
import { MessagingClient } from '@/platform/messaging-client';
import { ExtensionMessage } from '@/contracts/messages';

export const App: React.FC = () => {
  const [tabStatus, setTabStatus] = useState<TabStatus | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'reconnecting' | 'unsupported' | 'idle'>('idle');
  const [recoveredJob, setRecoveredJob] = useState<JobStateSnapshot | null>(null);
  const [isPicking, setIsPicking] = useState<boolean>(false);
  const [isDetecting, setIsDetecting] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');

  const messagingClient = new MessagingClient();

  useEffect(() => {
    // 1. Initial tab inspection
    const fetchTab = async () => {
      const tab = await getActiveTab();
      if (tab) {
        const status = getTabStatus(tab);
        setTabStatus(status);
        if (!status.isHarvestable) {
          setConnectionStatus('unsupported');
        } else {
          setConnectionStatus('connected');
        }
      } else {
        setConnectionStatus('unsupported');
      }
    };
    fetchTab();

    // 2. Check for suspended or recoverable jobs from previous service worker session
    const checkRecovery = async () => {
      const recovery = await recoverJobState();
      if (recovery.recovered && recovery.job) {
        setRecoveredJob(recovery.job);
      }
    };
    checkRecovery();

    // 3. Tab lifecycle observer
    const tabManager = new TabManager();
    const unsubscribe = tabManager.subscribe((status) => {
      setTabStatus(status);
      if (!status.isHarvestable) {
        setConnectionStatus('unsupported');
      } else {
        setConnectionStatus('connected');
      }
    });

    return () => {
      unsubscribe();
      tabManager.destroy();
    };
  }, []);

  const handleStartPicker = async () => {
    if (!tabStatus?.isHarvestable) return;

    setIsPicking(true);
    setStatusMessage('Element picker activated. Hover and click elements on the page.');

    try {
      const msg: ExtensionMessage = {
        id: `pick_${Date.now()}`,
        type: 'START_PICKER',
        timestamp: Date.now(),
        payload: {
          highlightColor: '#2563eb'
        }
      };
      await messagingClient.sendToActiveTab(msg);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage(`Failed to start element picker: ${msg}`);
      setIsPicking(false);
    }
  };

  const handleStopPicker = async () => {
    setIsPicking(false);
    setStatusMessage('Element picker stopped.');

    try {
      const msg: ExtensionMessage = {
        id: `stop_pick_${Date.now()}`,
        type: 'STOP_PICKER',
        timestamp: Date.now()
      };
      await messagingClient.sendToActiveTab(msg);
    } catch (err: unknown) {
      console.error('Failed to stop picker:', err);
    }
  };

  const handleAutoDetect = async () => {
    if (!tabStatus?.isHarvestable) return;

    setIsDetecting(true);
    setStatusMessage('Scanning DOM for repeating card/list patterns...');

    try {
      const msg: ExtensionMessage = {
        id: `detect_${Date.now()}`,
        type: 'DETECT_REPEATED_ELEMENTS',
        timestamp: Date.now()
      };
      const response = await messagingClient.sendToActiveTab<any>(msg);
      if (response && response.type === 'REPEATED_ELEMENTS_DETECTED') {
        setStatusMessage(`Found ${response.payload.matchCount} matching items (${response.payload.containerSelector})`);
      } else {
        setStatusMessage('Detection completed. Review suggested items.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage(`Auto-detect failed: ${msg}`);
    } finally {
      setIsDetecting(false);
    }
  };

  const handleDiscardRecoveredJob = async () => {
    await clearJobState();
    setRecoveredJob(null);
    setStatusMessage('Interrupted job discarded.');
  };

  return (
    <div className="flex flex-col h-screen w-full bg-slate-50 text-slate-900 font-sans p-4 select-none">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-slate-200 pb-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-sm shadow-sm">
            PH
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-800 leading-tight">PageHarvest</h1>
            <p className="text-xs text-slate-500">Local-First Web Harvester</p>
          </div>
        </div>

        {/* Status Badge */}
        <div>
          {connectionStatus === 'connected' && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Connected
            </span>
          )}
          {connectionStatus === 'unsupported' && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-100 text-rose-800">
              Restricted Page
            </span>
          )}
          {connectionStatus === 'idle' && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-200 text-slate-700">
              Connecting...
            </span>
          )}
        </div>
      </header>

      {/* Recovered Job Notification Banner */}
      {recoveredJob && (
        <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs shadow-sm">
          <div className="flex items-center justify-between mb-1 font-semibold">
            <span>Interrupted Job Recovered</span>
            <span className="text-amber-700">{recoveredJob.pagesVisited} pages / {recoveredJob.totalExtracted} rows</span>
          </div>
          <p className="text-amber-800 mb-2">
            A background service worker suspension interrupted extraction at {recoveredJob.url}.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleDiscardRecoveredJob}
              className="px-2.5 py-1 text-xs rounded bg-white border border-amber-300 hover:bg-amber-100 font-medium text-amber-900 transition"
            >
              Discard Job
            </button>
          </div>
        </div>
      )}

      {/* Active Tab Card */}
      <section className="bg-white rounded-lg border border-slate-200 p-3 shadow-sm mb-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
          Active Browser Tab
        </h2>
        {tabStatus ? (
          <div>
            <div className="text-sm font-medium text-slate-800 truncate" title={tabStatus.title}>
              {tabStatus.title || 'Untitled Page'}
            </div>
            <div className="text-xs text-slate-500 font-mono truncate" title={tabStatus.url}>
              {tabStatus.url || 'No URL'}
            </div>
            {!tabStatus.isHarvestable && (
              <div className="mt-2 text-xs text-rose-600 bg-rose-50 p-2 rounded border border-rose-100">
                {tabStatus.reason || 'PageHarvest cannot run on browser internal or extension store pages.'}
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-slate-400 italic">No active tab detected</div>
        )}
      </section>

      {/* Primary Actions */}
      <section className="flex flex-col gap-2 mb-4">
        <div className="grid grid-cols-2 gap-2">
          {!isPicking ? (
            <button
              onClick={handleStartPicker}
              disabled={!tabStatus?.isHarvestable}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium text-xs shadow transition active:scale-95"
            >
              Start Picker
            </button>
          ) : (
            <button
              onClick={handleStopPicker}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-medium text-xs shadow transition active:scale-95"
            >
              Stop Picker
            </button>
          )}

          <button
            onClick={handleAutoDetect}
            disabled={!tabStatus?.isHarvestable || isDetecting}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 disabled:opacity-50 text-slate-700 font-medium text-xs shadow-sm transition active:scale-95"
          >
            {isDetecting ? 'Detecting...' : 'Auto-Detect'}
          </button>
        </div>
      </section>

      {/* Status Output */}
      {statusMessage && (
        <section className="mb-4 p-2.5 bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-700 font-mono">
          {statusMessage}
        </section>
      )}

      {/* Footer Info */}
      <footer className="mt-auto pt-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-400">
        <span>Manifest V3 Local Engine</span>
        <span>v1.0.0</span>
      </footer>
    </div>
  );
};

export default App;

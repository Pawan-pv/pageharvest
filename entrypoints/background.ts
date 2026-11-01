import { defineBackground } from 'wxt/sandbox';
import { MessageRouter } from '@/platform/message-router';
import { recoverJobState } from '@/platform/job-recovery';
import { TabManager } from '@/platform/tab-manager';
import { triggerDownload } from '@/platform/downloads';
import { ExtensionMessage } from '@/contracts/messages';

export default defineBackground(() => {
  // 1. Configure Chrome Side Panel behavior
  if (typeof chrome !== 'undefined' && chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((err) => {
        console.warn('Could not set side panel panel behavior:', err);
      });
  }

  // 2. Service Worker recovery check upon activation/startup
  recoverJobState()
    .then((result) => {
      if (result.recovered && result.job) {
        console.info(
          `[PageHarvest ServiceWorker] Recovered suspended extraction job ${result.job.jobId} (${result.job.totalExtracted} records)`
        );
      }
    })
    .catch((err) => {
      console.error('[PageHarvest ServiceWorker] Recovery check failed:', err);
    });

  // 3. Tab manager instance for tracking active tab lifecycle
  const tabManager = new TabManager();

  // 4. Message router for background worker
  const router = new MessageRouter();

  router.on('PING', (msg) => {
    const pongResponse: ExtensionMessage = {
      id: `pong_${Date.now()}`,
      type: 'PONG',
      timestamp: Date.now(),
      payload: {
        status: 'OK',
        url: 'chrome-extension://background',
        title: 'PageHarvest Background Service Worker'
      }
    };
    return pongResponse;
  });

  router.listen();

  // 5. Cleanup on suspend/shutdown if supported
  if (typeof chrome !== 'undefined' && chrome.runtime?.onSuspend) {
    chrome.runtime.onSuspend.addListener(() => {
      tabManager.destroy();
      router.stop();
    });
  }
});

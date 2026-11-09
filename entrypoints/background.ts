import { defineBackground } from 'wxt/sandbox';
import { createChromeJobTransport } from '@/background/chrome-job-transport';
import { JobCoordinator } from '@/background/job-coordinator';
import { registerJobHandlers } from '@/background/register-job-handlers';
import { ExtensionMessage } from '@/contracts/messages';
import { MessageRouter } from '@/platform/message-router';
import { MessagingClient } from '@/platform/messaging-client';
import { TabManager } from '@/platform/tab-manager';
import { db } from '@/storage/db';

export default defineBackground(() => {
  // 1. Configure Chrome Side Panel behavior
  if (typeof chrome !== 'undefined' && chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((err) => {
        console.warn('Could not set side panel behavior:', err);
      });
  }

  // 2. The coordinator keeps all job state in IndexedDB, so a worker restarted between
  //    any two events picks up exactly where the previous one stopped.
  const coordinator = new JobCoordinator({
    db,
    transport: createChromeJobTransport(new MessagingClient()),
  });

  // 3. Message router for background worker
  const router = new MessageRouter();

  router.on('PING', () => {
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

  registerJobHandlers(router, coordinator);
  router.listen();

  // 4. Tab lifecycle feeds job interruption detection
  const tabManager = new TabManager();
  tabManager.onTabClosed((tabId) => {
    void coordinator.handleTabClosed(tabId);
  });
  tabManager.onTabLoaded((tabId) => {
    void coordinator.handleTabLoaded(tabId);
  });

  // 5. Content scripts and tabs do not survive these events, so running jobs are
  //    interrupted and offered for recovery.
  chrome.runtime.onStartup?.addListener(() => {
    void coordinator.reconcile('startup');
  });
  chrome.runtime.onInstalled?.addListener(() => {
    void coordinator.reconcile('installed');
  });

  // 6. Revoked site access moves active jobs on that origin to RECOVERABLE
  //    with SITE_PERMISSION_REQUIRED (ADR-037).
  if (typeof chrome !== 'undefined' && chrome.permissions?.onRemoved) {
    chrome.permissions.onRemoved.addListener((removed) => {
      void coordinator.handlePermissionRemoved(removed.origins ?? []);
    });
  }

  // 7. On every wake: expire abandoned sessions. Running jobs are left alone here,
  //    because a worker restart does not stop the page that is extracting.
  void coordinator.reconcile('wake').catch((err: unknown) => {
    console.error('[PageHarvest ServiceWorker] Reconciliation failed:', err);
  });

  // 7. Cleanup on suspend/shutdown if supported
  if (typeof chrome !== 'undefined' && chrome.runtime?.onSuspend) {
    chrome.runtime.onSuspend.addListener(() => {
      tabManager.destroy();
      router.stop();
    });
  }
});

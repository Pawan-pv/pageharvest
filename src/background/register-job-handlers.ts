import { ExtensionMessage } from '@/contracts/messages';
import { MessageRouter } from '@/platform/message-router';
import { JobCoordinator, MessageSenderInfo } from './job-coordinator';

type Sender = chrome.runtime.MessageSender;

function isExtensionPage(sender: Sender): boolean {
  if (typeof chrome === 'undefined' || !chrome.runtime?.getURL) return false;
  return typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''));
}

function pageSender(sender: Sender): MessageSenderInfo {
  return { tabId: sender.tab?.id };
}

const REJECTED_COMMAND = { ok: false, error: 'Only the PageHarvest side panel can control jobs.' };

const REJECTED_REPORT = {
  status: 'rejected' as const,
  sequence: 0,
  inserted: 0,
  duplicates: 0,
  reason: 'wrong_tab' as const,
};

/**
 * Connects the validated message router to the coordinator.
 *
 * Being inside the extension is not treated as sufficient trust: job commands are
 * only accepted from extension pages, and job reports only from a tab's content
 * script, which the coordinator further checks against the job's own identity.
 */
export function registerJobHandlers(router: MessageRouter, coordinator: JobCoordinator): void {
  const fromPanel = <T extends ExtensionMessage['type']>(
    type: T,
    handler: (message: Extract<ExtensionMessage, { type: T }>) => Promise<unknown>
  ) => {
    router.on(type, (message, sender) =>
      isExtensionPage(sender) ? handler(message) : Promise.resolve(REJECTED_COMMAND)
    );
  };

  const fromPage = <T extends ExtensionMessage['type']>(
    type: T,
    handler: (message: Extract<ExtensionMessage, { type: T }>, sender: MessageSenderInfo) => Promise<unknown>
  ) => {
    router.on(type, (message, sender) =>
      sender.tab?.id === undefined || isExtensionPage(sender)
        ? Promise.resolve(REJECTED_REPORT)
        : handler(message, pageSender(sender))
    );
  };

  fromPanel('START_JOB', (message) => coordinator.startJob(message.payload));
  fromPanel('PAUSE_JOB', (message) => coordinator.pauseJob(message.payload.jobId));
  fromPanel('RESUME_JOB', (message) => coordinator.resumeJob(message.payload.jobId));
  fromPanel('CANCEL_JOB', (message) => coordinator.cancelJob(message.payload.jobId));
  fromPanel('FINISH_JOB', (message) => coordinator.finishJob(message.payload.jobId));
  fromPanel('RECOVER_JOB', (message) => coordinator.recoverJob(message.payload.jobId));
  fromPanel('DISCARD_JOB', (message) => coordinator.discardJob(message.payload.jobId));
  fromPanel('RECONCILE_JOBS', async () => {
    await coordinator.reconcile('panel');
    return { ok: true };
  });

  // Data writes go through the background too (AGENTS.md: one writer). The router has
  // already validated each payload against its Zod schema before this handler runs.
  const dataCommand = async (work: () => Promise<{ deleted?: number } | void>) => {
    try {
      const result = await work();
      return { ok: true, ...(result && 'deleted' in result ? { deleted: result.deleted } : {}) };
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };

  fromPanel('CLEAR_USER_DATA', () => dataCommand(() => coordinator.clearUserData()));
  fromPanel('UPDATE_RECORD_CELL', (message) =>
    dataCommand(() =>
      coordinator.updateRecordCell(message.payload.recordId, message.payload.field, message.payload.value)
    )
  );
  fromPanel('DELETE_RECORDS', (message) =>
    dataCommand(async () => ({
      deleted: await coordinator.deleteRecords(message.payload.datasetId, message.payload.recordIds),
    }))
  );
  fromPanel('APPLY_DATASET_EDIT', (message) =>
    dataCommand(() =>
      coordinator.applyDatasetEdit(message.payload.datasetId, message.payload.records, message.payload.fields)
    )
  );

  fromPage('RECORD_BATCH', (message, sender) => coordinator.commitBatch(message.payload, sender));
  fromPage('JOB_CHECKPOINT', (message, sender) => coordinator.commitCheckpoint(message.payload, sender));
  fromPage('JOB_FINISHED', (message, sender) => coordinator.completeJob(message.payload, sender));
  fromPage('JOB_FAILED', (message, sender) => coordinator.reportJobFailure(message.payload, sender));

  router.on('CONTENT_READY', async (message, sender) => {
    if (sender.tab?.id !== undefined) {
      await coordinator.handleContentReady(message.payload.url, sender.tab.id);
    }
    return { ok: true };
  });
}

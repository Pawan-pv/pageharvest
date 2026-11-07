import { ExtractionErrorCodeSchema, type ExtractionErrorCode } from '@/shared/contracts/error';
import type { BannerTone } from './Banner';

export interface ErrorCopy {
  tone: BannerTone;
  title: string;
  whatHappened: string;
  dataSafety: string;
  nextStep: string;
  /**
   * The code's contract says its message is written for the user, so it is shown as the
   * body instead of behind the disclosure. Decided by code, never by reading the message.
   */
  bodyFromMessage?: boolean;
}

/**
 * What every error code means to the person using the panel: what happened, whether their
 * data is safe, and what to do. Keyed only by code; message text is never parsed.
 */
export const ERROR_COPY: Record<ExtractionErrorCode, ErrorCopy> = {
  CONTAINER_NOT_FOUND: {
    tone: 'danger',
    title: 'PageHarvest could not find those items',
    whatHappened: 'Nothing on this page matched what you asked for. The page may have changed or not finished loading.',
    dataSafety: 'Rows saved before this are safe.',
    nextStep: 'Wait for the page to finish loading and try again, or pick the items on the page yourself.',
  },
  FIELD_EXTRACTION_FAILED: {
    tone: 'warning',
    title: 'Some columns could not be read',
    whatHappened: 'One or more columns found no value in some items.',
    dataSafety: 'Those rows were kept, with the missing cells left empty.',
    nextStep: 'Check the column in Review fields, or pick it again on the page.',
  },
  PAGINATION_BUTTON_NOT_FOUND: {
    tone: 'warning',
    title: 'No Next button was found',
    whatHappened: 'PageHarvest could not find a button to reach the next page, so it stopped.',
    dataSafety: 'Every row collected so far is saved.',
    nextStep: 'If there are more pages, choose the button under Pagination, or try "Page numbers in the URL".',
  },
  PAGINATION_TIMEOUT: {
    tone: 'danger',
    title: 'The next page did not open',
    whatHappened: 'PageHarvest tried to reach the next page, but it did not load.',
    dataSafety: 'Rows from earlier pages are saved.',
    nextStep: 'Check that the page still works in the tab, set a longer wait under Pagination, Advanced, then try again.',
  },
  INFINITE_SCROLL_STALLED: {
    tone: 'info',
    title: 'No more items loaded',
    whatHappened: 'Scrolling stopped adding new items. This is normal at the end of a feed.',
    dataSafety: 'Every row collected so far is saved.',
    nextStep: 'If items are still missing, set a longer wait between scrolls and try again.',
  },
  TAB_DISCONNECTED: {
    tone: 'danger',
    title: 'Lost contact with the page',
    whatHappened: 'The tab was closed, reloaded, or moved to another site.',
    dataSafety: 'Rows saved before this are safe.',
    nextStep: 'Open the page again, then resume or start a new extraction.',
  },
  RATE_LIMITED: {
    tone: 'warning',
    title: 'The site asked PageHarvest to slow down',
    whatHappened: 'The site refused pages that were requested too quickly.',
    dataSafety: 'Every row collected so far is saved.',
    nextStep: 'Wait a few minutes, set a longer wait under Pagination, Advanced, then try again.',
  },
  STORAGE_ERROR: {
    tone: 'danger',
    title: 'Rows could not be saved',
    whatHappened: 'Your browser refused to store more data. The disk may be full.',
    dataSafety: 'Rows saved before this are safe; the rows being saved at that moment were not.',
    nextStep: 'Free some disk space, then try again. Exporting what you have keeps a copy.',
  },
  VALIDATION_ERROR: {
    tone: 'danger',
    title: 'This setup cannot run as it is',
    whatHappened: 'One of the settings is not valid.',
    dataSafety: 'Nothing was changed.',
    nextStep: 'Check the settings on this step and try again.',
    bodyFromMessage: true,
  },
  ABORTED_BY_USER: {
    tone: 'info',
    title: 'Extraction stopped',
    whatHappened: 'You stopped this extraction.',
    dataSafety: 'Rows collected so far are saved in Datasets.',
    nextStep: 'Open Datasets to see them, or start a new extraction.',
  },
  UNKNOWN_ERROR: {
    tone: 'danger',
    title: 'Something went wrong',
    whatHappened: 'PageHarvest ran into a problem it did not expect.',
    dataSafety: 'Rows already saved are safe.',
    nextStep: 'Try again. If it keeps happening, reload the page.',
  },
};

export interface PanelError {
  code?: string;
  message?: string;
}

export interface DescribedError extends ErrorCopy {
  code: ExtractionErrorCode;
  /** Technical detail for the disclosure: the code and the raw message. */
  details?: string;
}

/** Plain-language copy for an error. A missing or unrecognised code gets the generic copy. */
export function describeError(error: PanelError): DescribedError {
  const parsed = ExtractionErrorCodeSchema.safeParse(error.code);
  const code: ExtractionErrorCode = parsed.success ? parsed.data : 'UNKNOWN_ERROR';
  const message = error.message?.trim();
  const copy = ERROR_COPY[code];
  if (copy.bodyFromMessage && message) {
    return { ...copy, code, whatHappened: message, details: undefined };
  }
  const details = parsed.success ? [code, message].filter(Boolean).join(': ') : message;
  return { ...copy, code, details: details || undefined };
}

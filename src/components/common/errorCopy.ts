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
  /**
   * Wording for simple mode (ADR-039), where it differs: the usual text may point at a
   * control that only Advanced options shows, or use a word simple mode does not.
   */
  simple?: Partial<Pick<ErrorCopy, 'title' | 'whatHappened' | 'nextStep'>>;
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
    nextStep: 'Check the column on the Check columns step, or pick it again on the page.',
    simple: { nextStep: 'Look at your rows. If a column is mostly empty, collect the list again and untick it.' },
  },
  PAGINATION_BUTTON_NOT_FOUND: {
    tone: 'warning',
    title: 'No Next button was found',
    whatHappened: 'PageHarvest could not find a button to reach the next page, so it stopped.',
    dataSafety: 'Every row collected so far is saved.',
    nextStep: 'If there are more pages, choose the button under Pagination, or try "Page numbers in the URL".',
    simple: {
      nextStep:
        'If the list has more pages, collect it again and answer "Yes, more items appear when I scroll down". You can also point at the button yourself with Advanced options, in Settings.',
    },
  },
  PAGINATION_TIMEOUT: {
    tone: 'danger',
    title: 'The next page did not open',
    whatHappened: 'PageHarvest tried to reach the next page, but it did not load.',
    dataSafety: 'Rows from earlier pages are saved.',
    nextStep: 'Check that the page still works in the tab, set a longer wait under Pagination, Advanced, then try again.',
    simple: {
      nextStep:
        'Check that the page still works in its tab, then try again. A slow site may need a longer wait, which you can set with Advanced options, in Settings.',
    },
  },
  INFINITE_SCROLL_STALLED: {
    tone: 'info',
    title: 'No more items loaded',
    whatHappened: 'Scrolling stopped adding new items. This is normal at the end of a feed.',
    dataSafety: 'Every row collected so far is saved.',
    nextStep: 'If items are still missing, set a longer wait between scrolls and try again.',
    simple: {
      nextStep:
        'If items are still missing, try again. A slow site may need a longer wait, which you can set with Advanced options, in Settings.',
    },
  },
  TAB_DISCONNECTED: {
    tone: 'danger',
    title: 'Lost contact with the page',
    whatHappened: 'The tab was closed, reloaded, or moved to another site.',
    dataSafety: 'Rows saved before this are safe.',
    nextStep: 'Open the page again, then resume or start a new extraction.',
    simple: { nextStep: 'Open the page again, then press Continue, or start again.' },
  },
  RATE_LIMITED: {
    tone: 'warning',
    title: 'The site asked PageHarvest to slow down',
    whatHappened: 'The site refused pages that were requested too quickly.',
    dataSafety: 'Every row collected so far is saved.',
    nextStep: 'Wait a few minutes, set a longer wait under Pagination, Advanced, then try again.',
    simple: { nextStep: 'Wait a few minutes, then try again with fewer pages.' },
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
    dataSafety: 'Rows collected so far are saved in My data.',
    nextStep: 'Open My data to see them, or start a new extraction.',
    simple: {
      title: 'Stopped',
      whatHappened: 'You stopped the collecting.',
      nextStep: 'Open My data to see your rows, or get another list.',
    },
  },
  SITE_PERMISSION_REQUIRED: {
    tone: 'warning',
    title: 'PageHarvest needs access to this site to continue',
    whatHappened: 'PageHarvest needs access to this site to continue. Allow access?',
    dataSafety: 'Rows saved before this are safe.',
    nextStep: 'Choose Allow access below, then resume. No rows will be lost.',
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

/**
 * Plain-language copy for an error. A missing or unrecognised code gets the generic copy.
 * With `simple`, a code's simple-mode wording replaces the parts it names.
 */
export function describeError(error: PanelError, options: { simple?: boolean } = {}): DescribedError {
  const parsed = ExtractionErrorCodeSchema.safeParse(error.code);
  const code: ExtractionErrorCode = parsed.success ? parsed.data : 'UNKNOWN_ERROR';
  const message = error.message?.trim();
  const { simple: simpleCopy, ...shared } = ERROR_COPY[code];
  const copy: ErrorCopy = options.simple && simpleCopy ? { ...shared, ...simpleCopy } : shared;
  if (copy.bodyFromMessage && message) {
    return { ...copy, code, whatHappened: message, details: undefined };
  }
  const details = parsed.success ? [code, message].filter(Boolean).join(': ') : message;
  return { ...copy, code, details: details || undefined };
}

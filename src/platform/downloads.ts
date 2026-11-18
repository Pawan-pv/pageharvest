export interface DownloadOptions {
  filename: string;
  content: string | string[] | Uint8Array | ArrayBuffer | Blob;
  mimeType: string;
}

export interface DownloadResult {
  success: boolean;
  error?: string;
  /** Chrome's id for the download. Present when Chrome accepted it. */
  downloadId?: number;
}

/** Where a download Chrome accepted has got to. Only `complete` means the file is on disk. */
export type SavedFile =
  | { state: 'complete'; fileName: string }
  | { state: 'interrupted'; reason: string }
  | { state: 'in_progress' };

export function sanitizeFilename(filename: string, defaultName: string = 'pageharvest_export.csv'): string {
  if (!filename || filename.trim().length === 0) {
    return defaultName;
  }
  // Replace invalid filesystem characters: : / \ * ? " < > |
  const sanitized = filename.replace(/[:/\\*?"<>|]/g, '_');
  return sanitized.trim().length > 0 ? sanitized : defaultName;
}

/**
 * Releases the blob once Chrome has finished with the download. The blob must stay
 * alive until then, so it cannot be revoked as soon as the download starts.
 */
function revokeWhenFinished(downloadId: number | undefined, url: string): void {
  if (!url.startsWith('blob:')) return;

  const onChanged = chrome.downloads?.onChanged;
  if (typeof downloadId !== 'number' || !onChanged?.addListener) {
    return;
  }

  const listener = (delta: chrome.downloads.DownloadDelta) => {
    if (delta.id !== downloadId) return;
    const state = delta.state?.current;
    if (state === 'complete' || state === 'interrupted') {
      onChanged.removeListener(listener);
      URL.revokeObjectURL(url);
    }
  };
  onChanged.addListener(listener);
}

/**
 * The single export download path. The file goes straight to the user's Downloads folder,
 * with no "Save as" window to answer, and a name that is taken gets a number instead of
 * replacing the older file. Resolves with success only after the browser has accepted the
 * download; a refused download is reported as a failure. Accepted is not yet saved:
 * `waitForSavedFile` says when the file is on disk and what it is called.
 */
export async function triggerDownload(options: DownloadOptions): Promise<DownloadResult> {
  try {
    const filename = sanitizeFilename(options.filename);
    let url: string;

    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      const blobParts: BlobPart[] = Array.isArray(options.content)
        ? options.content
        : [options.content as unknown as BlobPart];
      const blob = new Blob(blobParts, {
        type: `${options.mimeType};charset=utf-8`,
      });
      url = URL.createObjectURL(blob);
    } else if (typeof options.content === 'string') {
      const encoded = encodeURIComponent(options.content);
      url = `data:${options.mimeType};charset=utf-8,${encoded}`;
    } else if (Array.isArray(options.content)) {
      // Fallback when URL.createObjectURL is unavailable (e.g. jsdom test env):
      // join string chunks into a single data URL.
      const encoded = encodeURIComponent(options.content.join(''));
      url = `data:${options.mimeType};charset=utf-8,${encoded}`;
    } else {
      return { success: false, error: 'Binary downloads require URL.createObjectURL support.' };
    }

    if (typeof chrome !== 'undefined' && chrome.downloads?.download) {
      const downloadId = await chrome.downloads.download({
        url,
        filename,
        saveAs: false,
        conflictAction: 'uniquify',
      });
      if (typeof downloadId !== 'number') {
        return { success: false, error: 'The download did not start.' };
      }
      revokeWhenFinished(downloadId, url);
      return { success: true, downloadId };
    }

    if (typeof document !== 'undefined') {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return { success: true };
    }

    return { success: false, error: 'No download mechanism is available in this context.' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/** Chrome's reasons for an interrupted download, in words a person can act on. */
const INTERRUPT_REASONS: Record<string, string> = {
  USER_CANCELED: 'The download was cancelled.',
  FILE_NO_SPACE: 'The disk is full.',
  FILE_ACCESS_DENIED: 'Chrome is not allowed to write to the Downloads folder.',
  FILE_NAME_TOO_LONG: 'The file name is too long for this folder.',
  FILE_TOO_LARGE: 'The file is too large for this disk.',
  FILE_BLOCKED: 'Chrome blocked the file.',
  FILE_VIRUS_INFECTED: 'Your antivirus blocked the file.',
  FILE_SECURITY_CHECK_FAILED: 'Chrome could not check the file, so it was not kept.',
  FILE_TRANSIENT_ERROR: 'The disk was busy.',
  FILE_FAILED: 'The file could not be written.',
};

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Follows a download Chrome accepted until the file is on disk, and reports the name it was
 * really saved under (Chrome adds a number when the name is taken). Only the file's name is
 * returned, never its folder. If Chrome has not finished within the time allowed, or cannot
 * be asked, the answer is `in_progress`: a file is never called saved on a guess.
 */
export async function waitForSavedFile(
  downloadId: number,
  { timeoutMs = 15_000, pollMs = 200 }: { timeoutMs?: number; pollMs?: number } = {}
): Promise<SavedFile> {
  if (typeof chrome === 'undefined' || !chrome.downloads?.search) return { state: 'in_progress' };
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const [item] = await chrome.downloads.search({ id: downloadId });
      if (item?.state === 'complete' && item.filename) {
        return { state: 'complete', fileName: baseName(item.filename) };
      }
      if (item?.state === 'interrupted') {
        const code = item.error ?? '';
        return { state: 'interrupted', reason: INTERRUPT_REASONS[code] ?? `Chrome stopped the download (${code || 'no reason given'}).` };
      }
    } catch {
      // Asked again until the time is up.
    }
    if (Date.now() + pollMs > deadline) return { state: 'in_progress' };
    await wait(pollMs);
  }
}

/** Opens the folder that holds a downloaded file, with the file selected. False if it could not. */
export function showInFolder(downloadId: number): boolean {
  try {
    if (typeof chrome === 'undefined' || !chrome.downloads?.show) return false;
    chrome.downloads.show(downloadId);
    return true;
  } catch {
    return false;
  }
}

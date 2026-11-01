export interface DownloadOptions {
  filename: string;
  content: string;
  mimeType: string;
}

export interface DownloadResult {
  success: boolean;
  error?: string;
}

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
 * The single export download path. Resolves with success only after the browser has
 * accepted the download; a refused or cancelled download is reported as a failure.
 */
export async function triggerDownload(options: DownloadOptions): Promise<DownloadResult> {
  try {
    const filename = sanitizeFilename(options.filename);
    let url: string;

    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      const blob = new Blob([options.content], { type: `${options.mimeType};charset=utf-8` });
      url = URL.createObjectURL(blob);
    } else {
      const encoded = encodeURIComponent(options.content);
      url = `data:${options.mimeType};charset=utf-8,${encoded}`;
    }

    if (typeof chrome !== 'undefined' && chrome.downloads?.download) {
      const downloadId = await chrome.downloads.download({
        url,
        filename,
        saveAs: true,
      });
      revokeWhenFinished(downloadId, url);
      return { success: true };
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

export interface DownloadOptions {
  filename: string;
  content: string | Blob;
  mimeType: string;
}

export interface DownloadResult {
  success: boolean;
  downloadId?: number;
  error?: string;
}

/**
 * Sanitizes file names to prevent directory traversal and invalid OS characters.
 */
export function sanitizeFilename(filename: string): string {
  if (!filename || !filename.trim()) {
    return 'pageharvest_export.csv';
  }

  // Remove control characters and illegal filesystem characters: \ / : * ? " < > |
  const sanitized = filename
    .trim()
    .replace(/[\\/:*?"<>|\x00-\x1f\x80-\x9f]/g, '_')
    .replace(/\s+/g, ' ');

  return sanitized || 'pageharvest_export.csv';
}

/**
 * Triggers a file download using Chrome's native Downloads API.
 */
export async function triggerDownload(options: DownloadOptions): Promise<DownloadResult> {
  const safeName = sanitizeFilename(options.filename);

  try {
    let url: string;

    if (typeof options.content === 'string') {
      // Build a base64 Data URL or Blob URL
      const encoded = encodeURIComponent(options.content);
      url = `data:${options.mimeType};charset=utf-8,${encoded}`;
    } else {
      url = URL.createObjectURL(options.content);
    }

    if (typeof chrome === 'undefined' || !chrome.downloads?.download) {
      return {
        success: false,
        error: 'Chrome Downloads API is not available in the current context'
      };
    }

    const downloadId = await chrome.downloads.download({
      url,
      filename: safeName,
      saveAs: true
    });

    return {
      success: true,
      downloadId
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Download failed: ${message}`
    };
  }
}

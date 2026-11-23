/**
 * Bulk image downloader runner with queue pacing, pause/resume, and cancel controls.
 */

export interface DownloadTarget {
  url: string;
  filename: string;
}

export interface ImageDownloadProgress {
  completed: number;
  failed: number;
  total: number;
  currentFilename?: string;
  status: 'running' | 'paused' | 'stopped' | 'completed';
}

export interface ImageDownloaderRunnerOptions {
  targets: DownloadTarget[];
  minDelayMs?: number;
  onProgress?: (progress: ImageDownloadProgress) => void;
  downloadFn?: (options: { url: string; filename: string }) => Promise<number | undefined>;
}

export class ImageDownloaderRunner {
  private readonly targets: DownloadTarget[];
  private readonly minDelayMs: number;
  private readonly onProgress?: (progress: ImageDownloadProgress) => void;
  private readonly downloadFn: (options: { url: string; filename: string }) => Promise<number | undefined>;

  private _status: ImageDownloadProgress['status'] = 'stopped';
  private completed = 0;
  private failed = 0;
  private pauseResolver: (() => void) | null = null;

  constructor(options: ImageDownloaderRunnerOptions) {
    this.targets = options.targets;
    this.minDelayMs = Math.max(100, options.minDelayMs ?? 300);
    this.onProgress = options.onProgress;
    this.downloadFn = options.downloadFn ?? (async ({ url, filename }) => {
      if (typeof chrome !== 'undefined' && chrome.downloads?.download) {
        return await chrome.downloads.download({
          url,
          filename,
          conflictAction: 'uniquify',
        });
      }
      return 1;
    });
  }

  public getStatus(): ImageDownloadProgress['status'] {
    return this._status;
  }

  public async start(): Promise<void> {
    if (this.getStatus() === 'running') return;
    this._status = 'running';
    this.completed = 0;
    this.failed = 0;

    this.emitProgress();

    for (let i = 0; i < this.targets.length; i++) {
      if (this.getStatus() === 'stopped') break;

      while (this.getStatus() === 'paused') {
        await new Promise<void>((resolve) => {
          this.pauseResolver = resolve;
        });
      }

      if (this.getStatus() === 'stopped') break;

      const target = this.targets[i];
      this.emitProgress(target.filename);

      try {
        await this.downloadFn({ url: target.url, filename: target.filename });
        this.completed++;
      } catch {
        this.failed++;
      }

      this.emitProgress();

      if (i < this.targets.length - 1 && this.getStatus() === 'running') {
        await new Promise((resolve) => setTimeout(resolve, this.minDelayMs));
      }
    }

    if (this.getStatus() !== 'stopped') {
      this._status = 'completed';
      this.emitProgress();
    }
  }

  public pause(): void {
    if (this.getStatus() === 'running') {
      this._status = 'paused';
      this.emitProgress();
    }
  }

  public resume(): void {
    if (this.getStatus() === 'paused') {
      this._status = 'running';
      this.emitProgress();
      if (this.pauseResolver) {
        this.pauseResolver();
        this.pauseResolver = null;
      }
    }
  }

  public cancel(): void {
    this._status = 'stopped';
    if (this.pauseResolver) {
      this.pauseResolver();
      this.pauseResolver = null;
    }
    this.emitProgress();
  }

  private emitProgress(currentFilename?: string): void {
    this.onProgress?.({
      completed: this.completed,
      failed: this.failed,
      total: this.targets.length,
      currentFilename,
      status: this._status,
    });
  }
}

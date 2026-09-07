import type { Download, Page } from 'playwright-core';
import { mkdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { BrowserEventEmitter } from './BrowserEvents.js';
import { Logger } from '../logging/Logger.js';

export interface DownloadRecord {
  id: string;
  taskId?: string;
  tabId?: string;
  filename: string;
  suggestedFilename: string;
  savePath: string;
  url: string;
  fileSize?: number;
  status: 'in_progress' | 'completed' | 'failed';
  error?: string;
  startedAt: string;
  completedAt?: string;
}

export interface DownloadManagerOptions {
  baseDownloadDir: string;
  emitter: BrowserEventEmitter;
  logger: Logger;
  maxFileSizeBytes?: number;
}

export class DownloadManager {
  private downloads = new Map<string, DownloadRecord>();
  private currentTaskId: string | null = null;
  private attachedPages = new WeakSet<Page>();
  private baseDownloadDir: string;
  private emitter: BrowserEventEmitter;
  private logger: Logger;
  private maxFileSizeBytes: number;

  constructor(options: DownloadManagerOptions) {
    this.baseDownloadDir = options.baseDownloadDir;
    this.emitter = options.emitter;
    this.logger = options.logger;
    this.maxFileSizeBytes = options.maxFileSizeBytes ?? 50 * 1024 * 1024; // 50MB default
  }

  /**
   * Sets the active task ID so future downloads are stored under that task's folder.
   */
  public setTaskId(taskId?: string | null): void {
    this.currentTaskId = taskId || null;
  }

  /**
   * Gets the active task ID.
   */
  public getTaskId(): string | null {
    return this.currentTaskId;
  }

  /**
   * Attaches download interception to a Playwright Page.
   */
  public attachToPage(page: Page, tabId?: string): void {
    if (this.attachedPages.has(page)) {
      return;
    }
    this.attachedPages.add(page);

    page.on('download', async (download: Download) => {
      await this.handleDownload(download, tabId);
    });
  }

  /**
   * Processes an intercepted Playwright download.
   */
  public async handleDownload(download: Download, tabId?: string): Promise<DownloadRecord> {
    const downloadId = `dl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const suggestedFilename = download.suggestedFilename() || 'downloaded_file';
    const sanitizedFilename = this.sanitizeFilename(suggestedFilename);

    const taskFolder = this.currentTaskId ? this.currentTaskId : 'general';
    const targetDir = path.resolve(this.baseDownloadDir, taskFolder);

    try {
      mkdirSync(targetDir, { recursive: true });
    } catch (err) {
      this.logger.error('DownloadManager', `Failed to create download directory ${targetDir}: ${String(err)}`);
    }

    const uniqueSavePath = this.getUniqueFilePath(targetDir, sanitizedFilename);
    const finalFilename = path.basename(uniqueSavePath);

    const record: DownloadRecord = {
      id: downloadId,
      taskId: this.currentTaskId ?? undefined,
      tabId,
      filename: finalFilename,
      suggestedFilename,
      savePath: uniqueSavePath,
      url: typeof download.url === 'function' ? download.url() : '',
      status: 'in_progress',
      startedAt: new Date().toISOString(),
    };

    this.downloads.set(downloadId, record);

    this.logger.info('DownloadManager', `Download started: ${suggestedFilename}`, {
      downloadId,
      taskId: record.taskId,
      tabId,
      savePath: uniqueSavePath,
    });

    this.emitter.emitEvent('download.started', {
      downloadId,
      filename: finalFilename,
      path: uniqueSavePath,
      url: record.url,
      tabId,
      taskId: record.taskId,
    });

    try {
      await download.saveAs(uniqueSavePath);

      let fileSize = 0;
      if (existsSync(uniqueSavePath)) {
        const stats = statSync(uniqueSavePath);
        fileSize = stats.size;
      }

      record.status = 'completed';
      record.fileSize = fileSize;
      record.completedAt = new Date().toISOString();

      if (fileSize > this.maxFileSizeBytes) {
        this.logger.warn(
          'DownloadManager',
          `Downloaded file exceeds configured limit (${fileSize} > ${this.maxFileSizeBytes} bytes)`
        );
      }

      this.logger.info('DownloadManager', `Download completed: ${finalFilename} (${fileSize} bytes)`, {
        downloadId,
        taskId: record.taskId,
        fileSize,
      });

      this.emitter.emitEvent('download.completed', {
        downloadId,
        filename: finalFilename,
        path: uniqueSavePath,
        fileSize,
        url: record.url,
        tabId,
        taskId: record.taskId,
      });

      return record;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      record.status = 'failed';
      record.error = errorMsg;
      record.completedAt = new Date().toISOString();

      this.logger.warn('DownloadManager', `Download failed for ${suggestedFilename}: ${errorMsg}`, {
        downloadId,
        taskId: record.taskId,
        error: errorMsg,
      });

      return record;
    }
  }

  /**
   * Retrieves all download records, optionally filtered by taskId.
   */
  public getDownloads(taskId?: string): DownloadRecord[] {
    const list = Array.from(this.downloads.values());
    if (taskId !== undefined) {
      return list.filter((r) => r.taskId === taskId);
    }
    return list;
  }

  /**
   * Retrieves all successfully completed download records, optionally filtered by taskId.
   */
  public getCompletedDownloads(taskId?: string): DownloadRecord[] {
    return this.getDownloads(taskId).filter((r) => r.status === 'completed');
  }

  /**
   * Retrieves a specific download record by ID.
   */
  public getDownloadById(downloadId: string): DownloadRecord | undefined {
    return this.downloads.get(downloadId);
  }

  /**
   * Records a manual or programmatic download record (useful for testing or external file hooks).
   */
  public recordManualDownload(record: DownloadRecord): void {
    this.downloads.set(record.id, record);
    if (record.status === 'completed') {
      this.emitter.emitEvent('download.completed', {
        downloadId: record.id,
        filename: record.filename,
        path: record.savePath,
        fileSize: record.fileSize,
        url: record.url,
        tabId: record.tabId,
        taskId: record.taskId,
      });
    }
  }

  /**
   * Clears download records from memory, optionally for a specific task.
   */
  public clear(taskId?: string): void {
    if (taskId !== undefined) {
      for (const [id, record] of this.downloads.entries()) {
        if (record.taskId === taskId) {
          this.downloads.delete(id);
        }
      }
    } else {
      this.downloads.clear();
    }
  }

  /**
   * Sanitizes filenames to prevent directory traversal and illegal characters.
   */
  private sanitizeFilename(name: string): string {
    const base = path.basename(name);
    const cleaned = base.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
    return cleaned.length > 0 ? cleaned : 'unnamed_download';
  }

  /**
   * Ensures the destination path does not overwrite existing files by appending a counter.
   */
  private getUniqueFilePath(dir: string, filename: string): string {
    const { name, ext } = path.parse(filename);
    let target = path.join(dir, filename);
    let counter = 1;

    while (existsSync(target)) {
      target = path.join(dir, `${name}_${counter}${ext}`);
      counter++;
    }

    return target;
  }
}

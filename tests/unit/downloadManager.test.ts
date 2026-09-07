import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Page, Download } from 'playwright-core';
import { DownloadManager } from '../../src/browser/DownloadManager.js';
import { BrowserEventEmitter, type DownloadEventData } from '../../src/browser/BrowserEvents.js';
import { Logger } from '../../src/logging/Logger.js';
import { DocumentParser } from '../../src/research/DocumentParser.js';

describe('Phase 17: Autonomous File Download & Document Verification Pipeline', () => {
  let tempDir: string;
  let emitter: BrowserEventEmitter;
  let logger: Logger;
  let downloadManager: DownloadManager;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'odysseus-dl-test-'));
    emitter = new BrowserEventEmitter();
    logger = new Logger('error', () => {});
    downloadManager = new DownloadManager({
      baseDownloadDir: tempDir,
      emitter,
      logger,
      maxFileSizeBytes: 1024 * 1024, // 1MB for test
    });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup failure in tests
      }
    }
  });

  describe('DownloadManager Subsystem', () => {
    it('should initialize with empty downloads and task ID null', () => {
      expect(downloadManager.getDownloads()).toEqual([]);
      expect(downloadManager.getTaskId()).toBeNull();
    });

    it('should track active taskId', () => {
      downloadManager.setTaskId('task_abc123');
      expect(downloadManager.getTaskId()).toBe('task_abc123');
      downloadManager.setTaskId(null);
      expect(downloadManager.getTaskId()).toBeNull();
    });

    it('should intercept page download event and save file to task directory', async () => {
      const taskId = 'task_finance_01';
      downloadManager.setTaskId(taskId);

      const startedEvents: DownloadEventData[] = [];
      const completedEvents: DownloadEventData[] = [];
      emitter.onEvent('download.started', (data) => startedEvents.push(data));
      emitter.onEvent('download.completed', (data) => completedEvents.push(data));

      const pageListeners: Record<string, Function[]> = {};
      const mockPage = {
        on: vi.fn((event: string, handler: Function) => {
          pageListeners[event] = pageListeners[event] || [];
          pageListeners[event].push(handler);
          return mockPage;
        }),
      } as unknown as Page;

      downloadManager.attachToPage(mockPage, 'tab_001');
      expect(mockPage.on).toHaveBeenCalledWith('download', expect.any(Function));

      // Simulate download trigger from Playwright
      const mockDownload = {
        suggestedFilename: vi.fn(() => 'quarterly_report.csv'),
        url: vi.fn(() => 'https://example.com/downloads/quarterly_report.csv'),
        saveAs: vi.fn(async (targetPath: string) => {
          writeFileSync(targetPath, 'Date,Revenue,Expense\n2026-Q1,50000,30000\n2026-Q2,65000,35000\n');
        }),
      } as unknown as Download;

      const record = await downloadManager.handleDownload(mockDownload, 'tab_001');

      expect(record.status).toBe('completed');
      expect(record.taskId).toBe(taskId);
      expect(record.tabId).toBe('tab_001');
      expect(record.filename).toBe('quarterly_report.csv');
      expect(record.url).toBe('https://example.com/downloads/quarterly_report.csv');
      expect(existsSync(record.savePath)).toBe(true);
      expect(record.fileSize).toBeGreaterThan(0);

      // Verify event emissions
      expect(startedEvents).toHaveLength(1);
      expect(startedEvents[0].filename).toBe('quarterly_report.csv');
      expect(startedEvents[0].taskId).toBe(taskId);

      expect(completedEvents).toHaveLength(1);
      expect(completedEvents[0].filename).toBe('quarterly_report.csv');
      expect(completedEvents[0].fileSize).toBe(record.fileSize);
    });

    it('should sanitize dangerous filenames and handle file collisions uniquely', async () => {
      downloadManager.setTaskId('task_collision');

      const mockDownload1 = {
        suggestedFilename: vi.fn(() => '../../evil:file?.pdf'),
        url: vi.fn(() => 'https://example.com/evil.pdf'),
        saveAs: vi.fn(async (targetPath: string) => {
          writeFileSync(targetPath, '%PDF-1.4 Mock PDF Content');
        }),
      } as unknown as Download;

      const record1 = await downloadManager.handleDownload(mockDownload1);
      expect(record1.filename).not.toContain('..');
      expect(record1.filename).not.toContain(':');
      expect(record1.filename).not.toContain('?');
      expect(record1.filename).toContain('.pdf');

      // Second download with same name should not overwrite
      const mockDownload2 = {
        suggestedFilename: vi.fn(() => record1.filename),
        url: vi.fn(() => 'https://example.com/evil2.pdf'),
        saveAs: vi.fn(async (targetPath: string) => {
          writeFileSync(targetPath, '%PDF-1.4 Second Content');
        }),
      } as unknown as Download;

      const record2 = await downloadManager.handleDownload(mockDownload2);
      expect(record2.savePath).not.toBe(record1.savePath);
      expect(existsSync(record1.savePath)).toBe(true);
      expect(existsSync(record2.savePath)).toBe(true);
    });

    it('should handle download failure gracefully without throwing uncaught rejection', async () => {
      downloadManager.setTaskId('task_fail');

      const mockDownload = {
        suggestedFilename: vi.fn(() => 'corrupt.zip'),
        url: vi.fn(() => 'https://example.com/corrupt.zip'),
        saveAs: vi.fn(async () => {
          throw new Error('Network connection aborted by remote host');
        }),
      } as unknown as Download;

      const record = await downloadManager.handleDownload(mockDownload);

      expect(record.status).toBe('failed');
      expect(record.error).toContain('Network connection aborted');
      expect(downloadManager.getCompletedDownloads('task_fail')).toHaveLength(0);
      expect(downloadManager.getDownloads('task_fail')).toHaveLength(1);
    });

    it('should isolate and query downloads by taskId', () => {
      downloadManager.recordManualDownload({
        id: 'dl_1',
        taskId: 'task_A',
        filename: 'fileA.txt',
        suggestedFilename: 'fileA.txt',
        savePath: '/path/fileA.txt',
        url: 'https://example.com/fileA.txt',
        status: 'completed',
        fileSize: 120,
        startedAt: new Date().toISOString(),
      });

      downloadManager.recordManualDownload({
        id: 'dl_2',
        taskId: 'task_B',
        filename: 'fileB.txt',
        suggestedFilename: 'fileB.txt',
        savePath: '/path/fileB.txt',
        url: 'https://example.com/fileB.txt',
        status: 'completed',
        fileSize: 240,
        startedAt: new Date().toISOString(),
      });

      expect(downloadManager.getDownloads('task_A')).toHaveLength(1);
      expect(downloadManager.getDownloads('task_B')).toHaveLength(1);
      expect(downloadManager.getDownloads()).toHaveLength(2);

      downloadManager.clear('task_A');
      expect(downloadManager.getDownloads('task_A')).toHaveLength(0);
      expect(downloadManager.getDownloads('task_B')).toHaveLength(1);
    });
  });

  describe('DocumentParser Autonomous Verification Pipeline', () => {
    it('should parse downloaded CSV and generate verification summary fact', async () => {
      const csvPath = path.join(tempDir, 'test_invoice.csv');
      writeFileSync(
        csvPath,
        'InvoiceID,Client,Amount,Status\nINV-001,Acme Corp,$1250,Paid\nINV-002,Wayne Enterprises,$3400,Pending\n'
      );

      const parser = new DocumentParser();
      const parsed = await parser.parse(csvPath);

      expect(parsed.fileType).toBe('csv');
      expect(parsed.structuredData).toHaveLength(2);
      expect(parsed.rawText).toContain('INV-001');
      expect(parsed.rawText).toContain('Acme Corp');

      const verificationFact = `[Downloaded Document Verified]: "${parsed.fileName}" (Type: ${parsed.fileType.toUpperCase()}). Content: ${parsed.rawText.slice(0, 500).replace(/\r?\n+/g, ' ')}`;
      expect(verificationFact).toContain('[Downloaded Document Verified]');
      expect(verificationFact).toContain('test_invoice.csv');
      expect(verificationFact).toContain('INV-001');
    });

    it('should parse downloaded JSON and extract structured fields', async () => {
      const jsonPath = path.join(tempDir, 'metrics.json');
      writeFileSync(
        jsonPath,
        JSON.stringify({
          service: 'billing-api',
          uptime: 0.9998,
          activeSubscriptions: 1420,
        })
      );

      const parser = new DocumentParser();
      const parsed = await parser.parse(jsonPath);

      expect(parsed.fileType).toBe('json');
      expect((parsed.structuredData as Record<string, unknown>).service).toBe('billing-api');
      expect(parsed.rawText).toContain('billing-api');
      expect(parsed.rawText).toContain('1420');
    });
  });
});

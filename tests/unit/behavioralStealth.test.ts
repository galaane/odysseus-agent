import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { BezierMouseEngine } from '../../src/stealth/BezierMouseEngine.js';
import { KeystrokeJitterEngine } from '../../src/stealth/KeystrokeJitterEngine.js';
import { ProfileHealthMonitor } from '../../src/stealth/ProfileHealthMonitor.js';
import type { Point } from '../../src/stealth/types.js';
import { Logger } from '../../src/logging/Logger.js';

describe('Phase 38: Behavioral Entropy & Long-Lived Profile Camouflage Engine', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger('error');
  });

  describe('BezierMouseEngine', () => {
    let mouseEngine: BezierMouseEngine;

    beforeEach(() => {
      mouseEngine = new BezierMouseEngine(logger);
    });

    it('should compute exact boundary coordinates on cubic Bézier curves', () => {
      const p0: Point = { x: 100, y: 100 };
      const p1: Point = { x: 150, y: 200 };
      const p2: Point = { x: 250, y: 200 };
      const p3: Point = { x: 300, y: 100 };

      const start = mouseEngine.cubicBezier(p0, p1, p2, p3, 0);
      expect(start.x).toBe(100);
      expect(start.y).toBe(100);

      const end = mouseEngine.cubicBezier(p0, p1, p2, p3, 1);
      expect(end.x).toBe(300);
      expect(end.y).toBe(100);

      const mid = mouseEngine.cubicBezier(p0, p1, p2, p3, 0.5);
      expect(mid.x).toBe(200);
      expect(mid.y).toBeGreaterThan(100); // curve arches towards y=200
    });

    it('should calculate bell-shaped easeInOut interpolation', () => {
      expect(mouseEngine.easeInOut(0)).toBe(0);
      expect(mouseEngine.easeInOut(1)).toBe(1);
      expect(mouseEngine.easeInOut(0.5)).toBe(0.5);
      // Slow start: at s=0.2, easeInOut(s) should be < 0.2 (0.04 * 2.6 = 0.104)
      expect(mouseEngine.easeInOut(0.2)).toBeLessThan(0.2);
      // Fast finish: at s=0.8, easeInOut(s) should be > 0.8
      expect(mouseEngine.easeInOut(0.8)).toBeGreaterThan(0.8);
    });

    it('should generate human trajectory with curvature and duration in natural mode', () => {
      const start: Point = { x: 50, y: 50 };
      const end: Point = { x: 500, y: 400 };

      const traj = mouseEngine.generateTrajectory(start, end, {
        mode: 'natural_human',
        steps: 20,
      });

      expect(traj.start).toEqual(start);
      expect(traj.end).toEqual(end);
      expect(traj.points.length).toBeGreaterThan(15);
      expect(traj.durationMs).toBeGreaterThan(100);

      // Verify intermediate points lie between or slightly deviated from straight chord
      const firstMid = traj.points[5];
      expect(firstMid.x).toBeGreaterThan(start.x);
      expect(firstMid.x).toBeLessThan(end.x);
    });

    it('should generate zero-duration direct path in fast mode', () => {
      const start: Point = { x: 10, y: 10 };
      const end: Point = { x: 200, y: 200 };

      const traj = mouseEngine.generateTrajectory(start, end, { mode: 'fast' });
      expect(traj.durationMs).toBe(0);
      expect(traj.points).toEqual([start, end]);
    });

    it('should add micro-overshoot and settling points when overshoot is enabled', () => {
      const start: Point = { x: 10, y: 10 };
      const end: Point = { x: 300, y: 300 };

      const traj = mouseEngine.generateTrajectory(start, end, {
        overshoot: true,
        steps: 15,
      });

      // Overshoot adds 2 additional settling waypoints at the end
      expect(traj.points.length).toBe(18); // 16 steps + 2 settling
      const finalPoint = traj.points[traj.points.length - 1];
      expect(finalPoint).toEqual(end);
    });

    it('should execute organic movement and click on mock Playwright page', async () => {
      const mockPage = {
        mouse: {
          move: vi.fn().mockResolvedValue(undefined),
          down: vi.fn().mockResolvedValue(undefined),
          up: vi.fn().mockResolvedValue(undefined),
        },
      } as any;

      mouseEngine.setPosition({ x: 0, y: 0 });
      await mouseEngine.click(mockPage, { x: 120, y: 80 }, { mode: 'fast' });

      expect(mockPage.mouse.move).toHaveBeenCalled();
      expect(mockPage.mouse.down).toHaveBeenCalled();
      expect(mockPage.mouse.up).toHaveBeenCalled();
    });
  });

  describe('KeystrokeJitterEngine', () => {
    let keystrokeEngine: KeystrokeJitterEngine;

    beforeEach(() => {
      keystrokeEngine = new KeystrokeJitterEngine(logger);
    });

    it('should produce jittered delays within reasonable human boundaries', () => {
      for (let i = 0; i < 20; i++) {
        const delay = keystrokeEngine.calculateKeystrokeDelay('a', {
          minDelayMs: 30,
          maxDelayMs: 80,
          cognitivePauseWord: false,
        });
        expect(delay).toBeGreaterThanOrEqual(30);
        expect(delay).toBeLessThanOrEqual(80);
      }
    });

    it('should inject cognitive pauses on spaces and punctuation marks', () => {
      const letterDelay = keystrokeEngine.calculateKeystrokeDelay('x', {
        minDelayMs: 30,
        maxDelayMs: 60,
        cognitivePauseWord: true,
      });

      const spaceDelay = keystrokeEngine.calculateKeystrokeDelay(' ', {
        minDelayMs: 30,
        maxDelayMs: 60,
        cognitivePauseWord: true,
      });

      const periodDelay = keystrokeEngine.calculateKeystrokeDelay('.', {
        minDelayMs: 30,
        maxDelayMs: 60,
        cognitivePauseWord: true,
      });

      // Space adds 80-180ms extra
      expect(spaceDelay).toBeGreaterThan(letterDelay);
      // Period adds 120-250ms extra
      expect(periodDelay).toBeGreaterThan(letterDelay);
    });

    it('should bypass delays in fast mode', () => {
      expect(keystrokeEngine.calculateKeystrokeDelay('a', { mode: 'fast' })).toBe(0);
      expect(keystrokeEngine.calculateKeystrokeDelay(' ', { mode: 'fast' })).toBe(0);
    });

    it('should compute schedule for string sequence', () => {
      const schedule = keystrokeEngine.getTypingSchedule('Hi all.', { mode: 'fast' });
      expect(schedule.length).toBe(7);
      expect(schedule.map((s) => s.char).join('')).toBe('Hi all.');
      expect(schedule.every((s) => s.delayMs === 0)).toBe(true);
    });

    it('should type text on mock Playwright page', async () => {
      const mockPage = {
        keyboard: {
          type: vi.fn().mockResolvedValue(undefined),
        },
      } as any;

      await keystrokeEngine.typeText(mockPage, 'hello', { mode: 'fast' });
      expect(mockPage.keyboard.type).toHaveBeenCalledWith('hello', { delay: 0 });
    });
  });

  describe('ProfileHealthMonitor', () => {
    let tempDir: string;
    let monitor: ProfileHealthMonitor;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'odysseus-profile-test-'));
      monitor = new ProfileHealthMonitor(tempDir, logger);

      // Create realistic Chromium profile tree
      // 1. Protected session data
      await fs.mkdir(path.join(tempDir, 'Default', 'Local Storage'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'Default', 'Cookies'), 'session_cookie_secret_content');
      await fs.writeFile(path.join(tempDir, 'Default', 'Preferences'), '{"profile":{"name":"Odysseus"}}');

      // 2. Ephemeral cache to clean
      await fs.mkdir(path.join(tempDir, 'Default', 'Cache'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'Default', 'Cache', 'data_0'), 'cached_blob_asset_1');
      await fs.writeFile(path.join(tempDir, 'Default', 'Cache', 'data_1'), 'cached_blob_asset_2');

      // 3. Crashpad dumps
      await fs.mkdir(path.join(tempDir, 'Crashpad', 'completed'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'Crashpad', 'completed', 'crash_1.dmp'), 'dump_data');
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    });

    it('should enforce protection patterns on critical authentication data', () => {
      expect(monitor.isProtected(path.join(tempDir, 'Default', 'Cookies'))).toBe(true);
      expect(monitor.isProtected(path.join(tempDir, 'Default', 'Local Storage', 'leveldb'))).toBe(true);
      expect(monitor.isProtected(path.join(tempDir, 'Default', 'IndexedDB', 'store'))).toBe(true);
      expect(monitor.isProtected(path.join(tempDir, 'Default', 'Preferences'))).toBe(true);

      // Ephemeral caches are not protected
      expect(monitor.isProtected(path.join(tempDir, 'Default', 'Cache', 'data_0'))).toBe(false);
      expect(monitor.isProtected(path.join(tempDir, 'Crashpad', 'completed', 'crash.dmp'))).toBe(false);
    });

    it('should inspect profile and compute accurate disk & cache usage', async () => {
      const report = await monitor.inspectProfile();
      expect(report.profileDir).toBe(tempDir);
      expect(report.diskUsageBytes).toBeGreaterThan(0);
      expect(report.cacheUsageBytes).toBeGreaterThan(0);
      expect(report.orphanedFilesCount).toBe(1); // crash_1.dmp
      expect(report.status).toBe('optimal');
    });

    it('should support dryRun cleanup without deleting files', async () => {
      const res = await monitor.cleanProfile({ dryRun: true });
      expect(res.dryRun).toBe(true);
      expect(res.deletedFilesCount).toBe(3); // 2 in Cache + 1 in Crashpad
      expect(res.freedBytes).toBeGreaterThan(0);

      // Verify files still exist after dryRun
      const cacheExists = await fs.access(path.join(tempDir, 'Default', 'Cache', 'data_0')).then(() => true).catch(() => false);
      expect(cacheExists).toBe(true);
    });

    it('should safely purge ephemeral files while strictly preserving cookies and session files', async () => {
      const res = await monitor.cleanProfile({ dryRun: false });
      expect(res.dryRun).toBe(false);
      expect(res.deletedFilesCount).toBe(3);

      // Verify ephemeral cache files were deleted
      const cacheExists = await fs.access(path.join(tempDir, 'Default', 'Cache', 'data_0')).then(() => true).catch(() => false);
      expect(cacheExists).toBe(false);

      const dumpExists = await fs.access(path.join(tempDir, 'Crashpad', 'completed', 'crash_1.dmp')).then(() => true).catch(() => false);
      expect(dumpExists).toBe(false);

      // CRITICAL CHECK: Verify Cookies and Preferences remain completely untouched
      const cookiesExist = await fs.access(path.join(tempDir, 'Default', 'Cookies')).then(() => true).catch(() => false);
      expect(cookiesExist).toBe(true);
      const cookieContent = await fs.readFile(path.join(tempDir, 'Default', 'Cookies'), 'utf-8');
      expect(cookieContent).toBe('session_cookie_secret_content');

      const prefExist = await fs.access(path.join(tempDir, 'Default', 'Preferences')).then(() => true).catch(() => false);
      expect(prefExist).toBe(true);
    });
  });

  describe('AgentLoop Stealth Integration', () => {
    it('should expose BezierMouseEngine, KeystrokeJitterEngine, and ProfileHealthMonitor via getters', async () => {
      const { AgentLoop } = await import('../../src/agent/AgentLoop.js');

      const mockBrowserManager = {
        getTabManager: () => ({ getActiveTab: () => ({ id: 'tab_1' }), listTabs: () => [] }),
        getTabBranchManager: () => ({ getActiveBranches: () => [] }),
        getPageManager: () => ({ getActivePage: () => null }),
        getMutex: () => ({ runExclusive: (fn: any) => fn() }),
      } as any;

      const loop = new AgentLoop({
        browserManager: mockBrowserManager,
        actionRegistry: {} as any,
        pageObserver: { getRegistry: () => ({}) } as any,
        llmProvider: {} as any,
        logger,
        config: {
          browserProfilePath: './data/browser-profile',
          screenshotDir: './data/screenshots',
        } as any,
      });

      expect(loop.getBezierMouse()).toBeInstanceOf(BezierMouseEngine);
      expect(loop.getKeystrokeEngine()).toBeInstanceOf(KeystrokeJitterEngine);
      expect(loop.getProfileHealthMonitor()).toBeInstanceOf(ProfileHealthMonitor);
    });
  });
});


import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteDatabase } from '../../src/persistence/Database.js';
import { WatcherRepository } from '../../src/persistence/WatcherRepository.js';
import { ConditionEvaluator } from '../../src/watcher/ConditionEvaluator.js';
import { StateWatcherEngine } from '../../src/watcher/StateWatcherEngine.js';
import type { WatcherJob, WatcherEvaluationResult } from '../../src/watcher/types.js';
import { ActionMutex } from '../../src/browser/ActionMutex.js';
import { Logger } from '../../src/logging/Logger.js';

describe('Phase 37: Long-Horizon Asynchronous State Watchers & Event-Driven Triggers', () => {
  let db: SqliteDatabase;
  let repo: WatcherRepository;
  let logger: Logger;

  beforeEach(() => {
    db = new SqliteDatabase({ path: ':memory:' });
    repo = new WatcherRepository(db);
    logger = new Logger('error');
  });

  afterEach(() => {
    db.close();
  });

  describe('WatcherRepository', () => {
    it('should save and retrieve watcher jobs', () => {
      const job: WatcherJob = {
        id: 'watch_001',
        name: 'Price drop on laptop',
        targetUrl: 'https://store.local/item/101',
        conditionType: 'price_below',
        conditionTarget: '.price-tag',
        conditionValue: 900,
        triggerType: 'notify_hitl',
        triggerPayload: { channel: 'slack', priority: 'high' },
        intervalMs: 30000,
        adaptiveJitter: true,
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      repo.saveJob(job);

      const retrieved = repo.getJob('watch_001');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.name).toBe('Price drop on laptop');
      expect(retrieved?.targetUrl).toBe('https://store.local/item/101');
      expect(retrieved?.conditionType).toBe('price_below');
      expect(retrieved?.conditionTarget).toBe('.price-tag');
      expect(retrieved?.conditionValue).toBe(900);
      expect(retrieved?.triggerPayload).toEqual({ channel: 'slack', priority: 'high' });
      expect(retrieved?.status).toBe('active');
      expect(retrieved?.adaptiveJitter).toBe(true);
    });

    it('should query active jobs and filter by URL', () => {
      const base = {
        conditionType: 'text_contains' as const,
        conditionTarget: 'body',
        conditionValue: 'In Stock',
        triggerType: 'notify_hitl' as const,
        intervalMs: 60000,
        adaptiveJitter: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      repo.saveJob({ ...base, id: 'j1', name: 'Job 1', targetUrl: 'https://site-a.com', status: 'active' });
      repo.saveJob({ ...base, id: 'j2', name: 'Job 2', targetUrl: 'https://site-a.com', status: 'paused' });
      repo.saveJob({ ...base, id: 'j3', name: 'Job 3', targetUrl: 'https://site-b.com', status: 'active' });

      const activeJobs = repo.getActiveJobs();
      expect(activeJobs.length).toBe(2);
      expect(activeJobs.map((j) => j.id).sort()).toEqual(['j1', 'j3']);

      const siteAJobs = repo.getJobsByUrl('https://site-a.com');
      expect(siteAJobs.length).toBe(2);
    });

    it('should update job status and record check timestamps', () => {
      const job: WatcherJob = {
        id: 'watch_status_test',
        name: 'Stock alert',
        targetUrl: 'https://shop.local/item',
        conditionType: 'element_present',
        conditionTarget: 'button.buy-now',
        conditionValue: '',
        triggerType: 'notify_hitl',
        intervalMs: 15000,
        adaptiveJitter: false,
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      repo.saveJob(job);
      const checkTime = Date.now();
      repo.recordCheck('watch_status_test', checkTime);

      let updated = repo.getJob('watch_status_test');
      expect(updated?.lastCheckedAt).toBe(checkTime);

      repo.updateJobStatus('watch_status_test', 'triggered');
      updated = repo.getJob('watch_status_test');
      expect(updated?.status).toBe('triggered');
    });

    it('should delete and clear jobs', () => {
      const job: WatcherJob = {
        id: 'watch_del',
        name: 'Delete test',
        targetUrl: 'https://example.com',
        conditionType: 'element_missing',
        conditionTarget: '.banner',
        conditionValue: '',
        triggerType: 'notify_hitl',
        intervalMs: 10000,
        adaptiveJitter: false,
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      repo.saveJob(job);
      expect(repo.getJob('watch_del')).not.toBeNull();
      repo.deleteJob('watch_del');
      expect(repo.getJob('watch_del')).toBeNull();
    });
  });

  describe('ConditionEvaluator', () => {
    let evaluator: ConditionEvaluator;

    beforeEach(() => {
      evaluator = new ConditionEvaluator(logger);
    });

    it('should extract currency values accurately from various global formats', () => {
      expect(evaluator.extractPrice('$1,299.99')).toBe(1299.99);
      expect(evaluator.extractPrice('€ 49,99')).toBe(49.99);
      expect(evaluator.extractPrice('Rp 150.000')).toBe(150000);
      expect(evaluator.extractPrice('£19.95')).toBe(19.95);
      expect(evaluator.extractPrice('Special discount: 850 USD')).toBe(850);
      expect(evaluator.extractPrice('No numbers here')).toBeNull();
    });

    it('should evaluate price_below and price_above conditions on text', () => {
      const jobBelow: WatcherJob = {
        id: 'j_below',
        name: 'Price Drop',
        targetUrl: 'https://store.local',
        conditionType: 'price_below',
        conditionTarget: '',
        conditionValue: 800,
        triggerType: 'notify_hitl',
        intervalMs: 1000,
        adaptiveJitter: false,
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      // $750 is below 800 -> true
      const res1 = evaluator.evaluateText('Current Price: $750.00', jobBelow);
      expect(res1.conditionMet).toBe(true);
      expect(res1.observedValue).toBe(750);

      // $850 is not below 800 -> false
      const res2 = evaluator.evaluateText('Current Price: $850.00', jobBelow);
      expect(res2.conditionMet).toBe(false);
      expect(res2.observedValue).toBe(850);

      const jobAbove: WatcherJob = {
        ...jobBelow,
        id: 'j_above',
        conditionType: 'price_above',
        conditionValue: 1000,
      };

      const res3 = evaluator.evaluateText('Current Price: $1,250.00', jobAbove);
      expect(res3.conditionMet).toBe(true);
      expect(res3.observedValue).toBe(1250);
    });

    it('should evaluate text_contains and regex_match conditions on text', () => {
      const jobText: WatcherJob = {
        id: 'j_text',
        name: 'Restock Check',
        targetUrl: 'https://store.local',
        conditionType: 'text_contains',
        conditionTarget: '',
        conditionValue: 'In Stock',
        triggerType: 'notify_hitl',
        intervalMs: 1000,
        adaptiveJitter: false,
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const res1 = evaluator.evaluateText('Product Availability: in stock now!', jobText);
      expect(res1.conditionMet).toBe(true);

      const res2 = evaluator.evaluateText('Currently Out of Stock', jobText);
      expect(res2.conditionMet).toBe(false);

      const jobRegex: WatcherJob = {
        ...jobText,
        id: 'j_regex',
        conditionType: 'regex_match',
        conditionValue: '\\b[0-9]{1,2}%\\s*off\\b',
      };

      const resRegex1 = evaluator.evaluateText('Limited Deal: 25% OFF today!', jobRegex);
      expect(resRegex1.conditionMet).toBe(true);

      const resRegex2 = evaluator.evaluateText('Standard pricing applies.', jobRegex);
      expect(resRegex2.conditionMet).toBe(false);
    });

    it('should evaluate element_present and element_missing on mock Playwright page', async () => {
      const mockPage = {
        locator: vi.fn().mockImplementation((selector: string) => ({
          count: vi.fn().mockResolvedValue(selector === '.target-found' ? 2 : 0),
          first: vi.fn().mockReturnValue({
            innerText: vi.fn().mockResolvedValue('Inner content'),
          }),
        })),
        innerText: vi.fn().mockResolvedValue('Body text'),
      } as any;

      const jobPresent: WatcherJob = {
        id: 'j_elem_pres',
        name: 'Element Check',
        targetUrl: 'https://store.local',
        conditionType: 'element_present',
        conditionTarget: '.target-found',
        conditionValue: '',
        triggerType: 'notify_hitl',
        intervalMs: 1000,
        adaptiveJitter: false,
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const resPres = await evaluator.evaluateOnPage(mockPage, jobPresent);
      expect(resPres.conditionMet).toBe(true);
      expect(resPres.observedValue).toBe(2);

      const jobMissing: WatcherJob = {
        ...jobPresent,
        id: 'j_elem_miss',
        conditionType: 'element_missing',
        conditionTarget: '.not-there',
      };

      const resMiss = await evaluator.evaluateOnPage(mockPage, jobMissing);
      expect(resMiss.conditionMet).toBe(true);
      expect(resMiss.observedValue).toBe(0);
    });
  });

  describe('StateWatcherEngine', () => {
    let engine: StateWatcherEngine;
    let mutex: ActionMutex;
    let mockBrowserManager: any;
    let mockPage: any;
    let mockContext: any;

    beforeEach(() => {
      mutex = new ActionMutex();
      mockPage = {
        goto: vi.fn().mockResolvedValue(null),
        waitForTimeout: vi.fn().mockResolvedValue(null),
        close: vi.fn().mockResolvedValue(null),
        locator: vi.fn().mockReturnValue({
          count: vi.fn().mockResolvedValue(1),
          first: () => ({
            innerText: vi.fn().mockResolvedValue('Current price: $499.00'),
          }),
        }),
        innerText: vi.fn().mockResolvedValue('Current price: $499.00'),
      };

      mockContext = {
        newPage: vi.fn().mockResolvedValue(mockPage),
      };

      mockBrowserManager = {
        getContext: vi.fn().mockReturnValue(mockContext),
        getTabManager: vi.fn().mockReturnValue({
          getActiveTab: vi.fn().mockReturnValue({ id: 'tab_001' }),
        }),
      };

      engine = new StateWatcherEngine({
        browserManager: mockBrowserManager,
        actionMutex: mutex,
        watcherRepo: repo,
        logger,
      });
    });

    afterEach(() => {
      engine.stop();
    });

    it('should compute jittered interval between 0.8x and 1.2x', () => {
      const baseInterval = 10000;
      for (let i = 0; i < 20; i++) {
        const jittered = engine.calculateNextInterval(baseInterval, true);
        expect(jittered).toBeGreaterThanOrEqual(8000);
        expect(jittered).toBeLessThanOrEqual(12000);
      }

      // Without jitter, returns exact interval
      const nonJittered = engine.calculateNextInterval(baseInterval, false);
      expect(nonJittered).toBe(10000);
    });

    it('should evaluate a job, acquire mutex, open isolated background page, and dispatch triggers on match', async () => {
      const triggeredJobCallback = vi.fn();
      const testEngine = new StateWatcherEngine({
        browserManager: mockBrowserManager,
        actionMutex: mutex,
        watcherRepo: repo,
        logger,
        onTrigger: triggeredJobCallback,
      });

      const job: WatcherJob = {
        id: 'watch_eval_run',
        name: 'Price drop below $600',
        targetUrl: 'https://store.local/gadget',
        conditionType: 'price_below',
        conditionTarget: '.price-tag',
        conditionValue: 600,
        triggerType: 'notify_hitl',
        triggerPayload: { alert: true },
        intervalMs: 60000,
        adaptiveJitter: false,
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      repo.saveJob(job);

      const result = await testEngine.evaluateJob('watch_eval_run');
      expect(result.conditionMet).toBe(true);
      expect(result.currentObservedValue).toBe(499);
      expect(result.dispatched).toBe(true);

      // Verify browser lifecycle on isolated page
      expect(mockContext.newPage).toHaveBeenCalled();
      expect(mockPage.goto).toHaveBeenCalledWith('https://store.local/gadget', expect.any(Object));
      expect(mockPage.close).toHaveBeenCalled();

      // Verify status updated to triggered in repo
      const updatedJob = repo.getJob('watch_eval_run');
      expect(updatedJob?.status).toBe('triggered');
      expect(updatedJob?.lastCheckedAt).toBeDefined();

      // Verify callback triggered
      expect(triggeredJobCallback).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'watch_eval_run' }),
        expect.objectContaining({ conditionMet: true })
      );
    });

    it('should manage job scheduling lifecycle (start, pause, resume, remove)', () => {
      const job: WatcherJob = {
        id: 'job_lifecycle',
        name: 'Lifecycle test',
        targetUrl: 'https://test.local',
        conditionType: 'text_contains',
        conditionTarget: 'body',
        conditionValue: 'Live',
        triggerType: 'notify_hitl',
        intervalMs: 100000,
        adaptiveJitter: false,
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      repo.saveJob(job);
      engine.start();
      expect(engine.getActiveTimerCount()).toBe(1);

      engine.pauseJob('job_lifecycle');
      expect(engine.getActiveTimerCount()).toBe(0);
      expect(repo.getJob('job_lifecycle')?.status).toBe('paused');

      engine.resumeJob('job_lifecycle');
      expect(engine.getActiveTimerCount()).toBe(1);
      expect(repo.getJob('job_lifecycle')?.status).toBe('active');

      engine.removeJob('job_lifecycle');
      expect(engine.getActiveTimerCount()).toBe(0);
      expect(repo.getJob('job_lifecycle')).toBeNull();
    });

    it('should trigger macro execution when triggerType is execute_macro', async () => {
      const mockMacroRepo = {
        getMacroById: vi.fn().mockReturnValue({
          id: 'macro_fast_buy',
          domain: 'store.local',
          intentKey: 'quick_buy',
          parameterKeys: [],
          steps: [],
          status: 'verified',
          successCount: 5,
          failureCount: 0,
          healingCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      } as any;

      const mockMacroExecutor = {
        executeMacro: vi.fn().mockResolvedValue({
          success: true,
          executedSteps: 2,
          healedCount: 0,
        }),
      } as any;

      const macroEngine = new StateWatcherEngine({
        browserManager: mockBrowserManager,
        actionMutex: mutex,
        watcherRepo: repo,
        macroRepo: mockMacroRepo,
        macroExecutor: mockMacroExecutor,
        logger,
      });

      const job: WatcherJob = {
        id: 'watch_macro_job',
        name: 'Auto-Buy when in stock',
        targetUrl: 'https://store.local/item',
        conditionType: 'text_contains',
        conditionTarget: 'body',
        conditionValue: 'Current price: $499.00',
        triggerType: 'execute_macro',
        triggerPayload: { macroId: 'macro_fast_buy', params: { qty: '1' } },
        intervalMs: 10000,
        adaptiveJitter: false,
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      repo.saveJob(job);

      const res = await macroEngine.evaluateJob('watch_macro_job');
      expect(res.conditionMet).toBe(true);
      expect(mockMacroRepo.getMacroById).toHaveBeenCalledWith('macro_fast_buy');
      expect(mockMacroExecutor.executeMacro).toHaveBeenCalled();
    });
  });
});


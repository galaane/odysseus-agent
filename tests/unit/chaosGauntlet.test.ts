import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ChaosInjector } from '../../src/adversarial/ChaosInjector.js';
import { ResilienceAuditor } from '../../src/adversarial/ResilienceAuditor.js';
import { ChaosGauntletRunner } from '../../src/adversarial/ChaosGauntletRunner.js';
import { SqliteDatabase } from '../../src/persistence/Database.js';
import { DomainPlaybookRepository } from '../../src/persistence/DomainPlaybookRepository.js';
import type { ChaosProfile, ChaosScenario, GauntletTrialResult } from '../../src/adversarial/types.js';
import { Logger } from '../../src/logging/Logger.js';

describe('Phase 35: Adversarial Self-Play & Chaos Testing Gauntlet', () => {
  let db: SqliteDatabase;
  let playbookRepo: DomainPlaybookRepository;
  let logger: Logger;

  beforeEach(() => {
    db = new SqliteDatabase({ path: ':memory:' });
    playbookRepo = new DomainPlaybookRepository(db);
    logger = new Logger('error');
  });

  afterEach(() => {
    db.close();
  });

  describe('ChaosInjector', () => {
    let injector: ChaosInjector;

    beforeEach(() => {
      injector = new ChaosInjector(logger);
    });

    it('should inject cookie consent banner overlay into page DOM', async () => {
      let evaluateCalled = false;
      const mockPage = {
        evaluate: vi.fn().mockImplementation(async (fn: () => void) => {
          evaluateCalled = true;
          fn();
        }),
      } as any;

      // Mock DOM document in node environment for the evaluate callback
      const elements: Record<string, any> = {};
      (globalThis as any).document = {
        getElementById: (id: string) => elements[id] || null,
        createElement: (tag: string) => {
          const el: any = { tagName: tag, style: {}, setAttribute: vi.fn(), appendChild: vi.fn() };
          return el;
        },
        body: {
          appendChild: (el: any) => {
            elements[el.id || 'body_child'] = el;
          },
        },
      };

      const result = await injector.injectModalOverlay(mockPage, 'cookie');
      expect(result).toBe(true);
      expect(mockPage.evaluate).toHaveBeenCalled();
      expect(injector.getInjectedFaults()).toContain('cookie_banner_injection');
    });

    it('should inject promotional modal with close button into page DOM', async () => {
      const mockPage = {
        evaluate: vi.fn().mockImplementation(async (fn: () => void) => {
          fn();
        }),
      } as any;

      const result = await injector.injectModalOverlay(mockPage, 'promo');
      expect(result).toBe(true);
      expect(injector.getInjectedFaults()).toContain('promo_modal_injection');
    });

    it('should attach and teardown network latency and HTTP 500 interception', async () => {
      let routeHandler: ((route: any) => Promise<void>) | null = null;
      const mockPage = {
        route: vi.fn().mockImplementation(async (_pattern: string, handler: any) => {
          routeHandler = handler;
        }),
        unroute: vi.fn(),
      } as any;

      const profile: ChaosProfile = {
        level: 'moderate',
        activeFaults: ['network_latency', 'network_500'],
        faultProbability: 1.0,
        networkLatencyMs: { min: 5, max: 10 },
      };

      const teardown = await injector.attachNetworkChaos(mockPage, profile);
      expect(mockPage.route).toHaveBeenCalledWith('**/*', expect.any(Function));
      expect(routeHandler).not.toBeNull();

      // Test simulated HTTP 500 on secondary endpoint
      const mockRoute500 = {
        request: () => ({ url: () => 'https://site.local/api/analytics' }),
        fulfill: vi.fn().mockResolvedValue(undefined),
        continue: vi.fn().mockResolvedValue(undefined),
      };
      if (routeHandler) {
        await (routeHandler as (route: any) => Promise<void>)(mockRoute500);
        expect(mockRoute500.fulfill).toHaveBeenCalledWith(
          expect.objectContaining({ status: 500 })
        );
        expect(injector.getInjectedFaults()).toContain('network_500');
      }

      await teardown();
      expect(mockPage.unroute).toHaveBeenCalledWith('**/*', expect.any(Function));
    });

    it('should mutate DOM attributes and simulate stale elements', async () => {
      const mockPage = {
        evaluate: vi.fn().mockResolvedValue(true),
      } as any;

      const mutated = await injector.mutateDomAttributes(mockPage, 'button.submit');
      expect(mutated).toBe(true);
      expect(injector.getInjectedFaults()).toContain('dom_mutation');

      const stale = await injector.simulateStaleElement(mockPage, 'button.submit');
      expect(stale).toBe(true);
      expect(injector.getInjectedFaults()).toContain('stale_element');
    });
  });

  describe('ResilienceAuditor', () => {
    let auditor: ResilienceAuditor;

    beforeEach(() => {
      auditor = new ResilienceAuditor(playbookRepo, logger);
    });

    it('should compute trial score factoring in success and unhandled error penalties', () => {
      const perfectScore = auditor.computeTrialScore({
        success: true,
        unhandledErrors: [],
        interventionsTriggered: ['retry'],
      });
      expect(perfectScore).toBe(1.0);

      const penalizedScore = auditor.computeTrialScore({
        success: true,
        unhandledErrors: ['Transient 500 error', 'DOM detached error'],
        interventionsTriggered: ['recovery_ladder'],
      });
      expect(penalizedScore).toBe(0.8);

      const failedScore = auditor.computeTrialScore({
        success: false,
        unhandledErrors: ['Fatal timeout'],
        interventionsTriggered: [],
      });
      expect(failedScore).toBe(0.0);
    });

    it('should audit trial results, compute resilience summary, and generate playbook rules', () => {
      const trials: GauntletTrialResult[] = [
        {
          trialId: 'trial_1',
          scenarioId: 'sc_1',
          scenarioName: 'E-commerce Search',
          chaosLevel: 'mild',
          success: true,
          stepsExecuted: 3,
          durationMs: 1200,
          faultsInjected: ['network_latency'],
          interventionsTriggered: ['retry_with_backoff'],
          unhandledErrors: [],
          resilienceScore: 1.0,
        },
        {
          trialId: 'trial_2',
          scenarioId: 'sc_2',
          scenarioName: 'Registration Form Under Modals',
          chaosLevel: 'moderate',
          success: true,
          stepsExecuted: 4,
          durationMs: 2500,
          faultsInjected: ['cookie_banner_injection', 'network_500'],
          interventionsTriggered: ['obstruction_clearance'],
          unhandledErrors: [],
          resilienceScore: 1.0,
        },
        {
          trialId: 'trial_3',
          scenarioId: 'sc_3',
          scenarioName: 'Dynamic Cart Mutation',
          chaosLevel: 'extreme',
          success: false,
          stepsExecuted: 6,
          durationMs: 5000,
          faultsInjected: ['dom_mutation', 'stale_element'],
          interventionsTriggered: [],
          unhandledErrors: ['Element detached from DOM'],
          resilienceScore: 0.0,
        },
      ];

      const summary = auditor.auditTrials(trials, 'test-site.local');
      expect(summary.totalTrials).toBe(3);
      expect(summary.passedTrials).toBe(2);
      expect(summary.overallPassRate).toBeCloseTo(0.667, 2);
      expect(summary.faultBreakdown.cookie_banner_injection.injected).toBe(1);
      expect(summary.faultBreakdown.cookie_banner_injection.recovered).toBe(1);
      expect(summary.synthesizedAntiPatterns.length).toBeGreaterThanOrEqual(2);

      // Verify persisted playbooks
      const playbooks = playbookRepo.getPlaybooksByDomain('test-site.local');
      expect(playbooks.length).toBeGreaterThanOrEqual(2);

      // Verify markdown report formatting
      const report = auditor.generateReport(summary, trials);
      expect(report.markdownReport).toContain('# Adversarial Chaos Gauntlet Resilience Report');
      expect(report.markdownReport).toContain('trial_1');
      expect(report.markdownReport).toContain('cookie_banner_injection');
    });
  });

  describe('ChaosGauntletRunner', () => {
    it('should build pre-packaged chaos profiles for mild, moderate, and extreme tiers', () => {
      const mild = ChaosGauntletRunner.createProfile('mild');
      expect(mild.level).toBe('mild');
      expect(mild.activeFaults).toContain('network_latency');
      expect(mild.faultProbability).toBe(0.3);

      const mod = ChaosGauntletRunner.createProfile('moderate');
      expect(mod.level).toBe('moderate');
      expect(mod.activeFaults).toContain('cookie_banner_injection');
      expect(mod.activeFaults).toContain('network_500');

      const extreme = ChaosGauntletRunner.createProfile('extreme');
      expect(extreme.level).toBe('extreme');
      expect(extreme.activeFaults.length).toBeGreaterThanOrEqual(5);
    });

    it('should execute chaos scenario and compile gauntlet report', async () => {
      const mockPage = {
        route: vi.fn(),
        unroute: vi.fn(),
        evaluate: vi.fn().mockResolvedValue(true),
      } as any;

      const mockBrowserManager = {
        getPageManager: () => ({
          getActivePage: () => mockPage,
        }),
        getContext: () => ({
          newPage: async () => mockPage,
        }),
      } as any;

      const mockAgentLoop = {
        run: vi.fn().mockResolvedValue({
          taskId: 'trial_test',
          status: 'completed',
          summary: 'Task succeeded under chaos',
          steps: 4,
          durationMs: 1500,
          findings: [],
        }),
      } as any;

      const injector = new ChaosInjector(logger);
      const auditor = new ResilienceAuditor(playbookRepo, logger);

      const runner = new ChaosGauntletRunner({
        agentLoop: mockAgentLoop,
        browserManager: mockBrowserManager,
        injector,
        auditor,
        logger,
      });

      const scenarios: ChaosScenario[] = [
        {
          id: 'sc_catalog_search',
          name: 'Catalog Search Resilience',
          description: 'Tests search under mild network latency',
          targetUrl: 'http://localhost:3000/catalog',
          taskGoal: 'Find laptop price in product catalog',
          profile: ChaosGauntletRunner.createProfile('mild'),
        },
        {
          id: 'sc_modal_clearance',
          name: 'Obstruction Clearance Resilience',
          description: 'Tests form submission under modal injection',
          targetUrl: 'http://localhost:3000/register',
          taskGoal: 'Submit registration form',
          profile: ChaosGauntletRunner.createProfile('moderate'),
        },
      ];

      const report = await runner.runGauntlet(scenarios);
      expect(report.trials.length).toBe(2);
      expect(report.summary.passedTrials).toBe(2);
      expect(report.summary.overallPassRate).toBe(1.0);
      expect(report.summary.averageResilienceScore).toBe(1.0);
      expect(mockAgentLoop.run).toHaveBeenCalledTimes(2);
    });
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteDatabase } from '../../src/persistence/Database.js';
import { HyperparameterRepository } from '../../src/persistence/HyperparameterRepository.js';
import { MetaOptimizer } from '../../src/optimization/MetaOptimizer.js';
import type { DomainHyperparameters, TaskExecutionMetric } from '../../src/optimization/types.js';
import { Logger } from '../../src/logging/Logger.js';
import { ReasoningStage } from '../../src/agent/pipeline/ReasoningStage.js';
import type { LLMProvider } from '../../src/llm/LLM.js';
import type { PageSnapshot } from '../../src/observer/PageSnapshot.js';

describe('Phase 36: Empirical Prompt & Hyperparameter Meta-Optimization', () => {
  let db: SqliteDatabase;
  let repo: HyperparameterRepository;
  let logger: Logger;
  let optimizer: MetaOptimizer;

  beforeEach(() => {
    db = new SqliteDatabase({ path: ':memory:' });
    repo = new HyperparameterRepository(db);
    logger = new Logger('error');
    optimizer = new MetaOptimizer(repo, logger);
  });

  afterEach(() => {
    db.close();
  });

  describe('HyperparameterRepository', () => {
    it('should return default hyperparameters when no record exists', () => {
      const defaults = repo.getEffectiveParams('example.com');
      expect(defaults.domainOrArchetype).toBe('global');
      expect(defaults.riskAversionFactor).toBe(0.5);
      expect(defaults.maxRetries).toBe(2);
      expect(defaults.tokenBudget).toBe(3000);
      expect(defaults.frustrationThreshold).toBe(3);
      expect(defaults.promptDirectives).toEqual([]);
    });

    it('should save and retrieve domain hyperparameters', () => {
      const params: DomainHyperparameters = {
        id: 'param_custom_domain',
        domainOrArchetype: 'shop.mystore.com',
        riskAversionFactor: 0.8,
        maxRetries: 5,
        tokenBudget: 3500,
        frustrationThreshold: 4,
        promptDirectives: ['prefer-exact-match', 'verify-stock-before-click'],
        sampleCount: 12,
        successCount: 10,
        updatedAt: new Date().toISOString(),
      };

      repo.saveParams(params);

      const retrieved = repo.getParams('shop.mystore.com');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.riskAversionFactor).toBe(0.8);
      expect(retrieved?.maxRetries).toBe(5);
      expect(retrieved?.tokenBudget).toBe(3500);
      expect(retrieved?.frustrationThreshold).toBe(4);
      expect(retrieved?.promptDirectives).toEqual(['prefer-exact-match', 'verify-stock-before-click']);
      expect(retrieved?.sampleCount).toBe(12);
      expect(retrieved?.successCount).toBe(10);
    });

    it('should resolve hierarchical fallback: domain -> archetype -> global -> default', () => {
      // 1. Global level
      repo.saveParams({
        id: 'param_global',
        domainOrArchetype: 'global',
        riskAversionFactor: 0.6,
        maxRetries: 4,
        tokenBudget: 2800,
        frustrationThreshold: 3,
        promptDirectives: ['global-safety-check'],
        sampleCount: 50,
        successCount: 45,
        updatedAt: new Date().toISOString(),
      });

      // No domain or archetype match -> fallback to global
      const fallbackGlobal = repo.getEffectiveParams('unknown.com', 'news');
      expect(fallbackGlobal.domainOrArchetype).toBe('global');
      expect(fallbackGlobal.riskAversionFactor).toBe(0.6);
      expect(fallbackGlobal.promptDirectives).toContain('global-safety-check');

      // 2. Archetype level
      repo.saveParams({
        id: 'param_archetype_ecommerce',
        domainOrArchetype: 'ecommerce',
        riskAversionFactor: 0.7,
        maxRetries: 5,
        tokenBudget: 3200,
        frustrationThreshold: 4,
        promptDirectives: ['dismiss-cookie-banners', 'wait-for-inventory'],
        sampleCount: 20,
        successCount: 18,
        updatedAt: new Date().toISOString(),
      });

      const fallbackArchetype = repo.getEffectiveParams('unknown-shop.com', 'ecommerce');
      expect(fallbackArchetype.domainOrArchetype).toBe('ecommerce');
      expect(fallbackArchetype.riskAversionFactor).toBe(0.7);
      expect(fallbackArchetype.tokenBudget).toBe(3200);

      // 3. Exact domain level
      repo.saveParams({
        id: 'param_domain_special',
        domainOrArchetype: 'special-shop.com',
        riskAversionFactor: 0.35,
        maxRetries: 2,
        tokenBudget: 2200,
        frustrationThreshold: 2,
        promptDirectives: ['fast-checkout-mode'],
        sampleCount: 5,
        successCount: 5,
        updatedAt: new Date().toISOString(),
      });

      const exactDomain = repo.getEffectiveParams('special-shop.com', 'ecommerce');
      expect(exactDomain.domainOrArchetype).toBe('special-shop.com');
      expect(exactDomain.riskAversionFactor).toBe(0.35);
      expect(exactDomain.promptDirectives).toEqual(['fast-checkout-mode']);
    });

    it('should delete parameters properly', () => {
      repo.saveParams({
        id: 'p1',
        domainOrArchetype: 'delete-me.com',
        riskAversionFactor: 0.5,
        maxRetries: 3,
        tokenBudget: 3000,
        frustrationThreshold: 3,
        promptDirectives: [],
        sampleCount: 1,
        successCount: 1,
        updatedAt: new Date().toISOString(),
      });

      expect(repo.getParams('delete-me.com')).not.toBeNull();
      repo.deleteParams('delete-me.com');
      expect(repo.getParams('delete-me.com')).toBeNull();
    });
  });

  describe('MetaOptimizer Adaptation Logic', () => {
    it('should adapt parameters upon task timeout or excessive steps', () => {
      const metric: TaskExecutionMetric = {
        taskId: 'task_001',
        domain: 'slow-portal.org',
        steps: 9,
        durationMs: 45000,
        success: false,
        failureReason: 'Operation timed out while awaiting element stabilization',
      };

      const proposal = optimizer.recordTaskOutcome(metric);
      expect(proposal).not.toBeNull();
      expect(proposal?.domainOrArchetype).toBe('slow-portal.org');
      // Risk aversion should be reduced from 0.5 to 0.45
      expect(proposal?.updatedParams.riskAversionFactor).toBe(0.45);
      // Token budget should be increased from 3000 to 3300
      expect(proposal?.updatedParams.tokenBudget).toBe(3300);
      // Frustration threshold increased from 3 to 4
      expect(proposal?.updatedParams.frustrationThreshold).toBe(4);
      expect(proposal?.reasoning).toContain('timeout');

      // Verify persisted in database
      const persisted = repo.getParams('slow-portal.org');
      expect(persisted?.riskAversionFactor).toBe(0.45);
      expect(persisted?.tokenBudget).toBe(3300);
      expect(persisted?.sampleCount).toBe(1);
      expect(persisted?.successCount).toBe(0);
    });

    it('should adapt parameters and inject directives upon selector or validation failures', () => {
      const metric: TaskExecutionMetric = {
        taskId: 'task_002',
        domain: 'dynamic-spa.net',
        steps: 4,
        durationMs: 12000,
        success: false,
        failureReason: 'Action execution failed: selector validation error on target button',
      };

      const proposal = optimizer.recordTaskOutcome(metric);
      expect(proposal).not.toBeNull();
      expect(proposal?.updatedParams.maxRetries).toBe(3); // from default 2 to 3
      expect(proposal?.updatedParams.riskAversionFactor).toBe(0.46); // from 0.5 - 0.04
      expect(proposal?.updatedParams.promptDirectives).toContain(
        'prefer-semantic-locators-and-wait-for-dom-settle'
      );

      const persisted = repo.getParams('dynamic-spa.net');
      expect(persisted?.maxRetries).toBe(3);
      expect(persisted?.promptDirectives).toContain('prefer-semantic-locators-and-wait-for-dom-settle');
    });

    it('should inject anti-fingerprinting directives upon bot detection or captcha failure', () => {
      const metric: TaskExecutionMetric = {
        taskId: 'task_003',
        domain: 'protected-portal.com',
        steps: 2,
        durationMs: 6000,
        success: false,
        failureReason: 'bot_detection: Cloudflare challenge detected',
      };

      const proposal = optimizer.recordTaskOutcome(metric);
      expect(proposal).not.toBeNull();
      expect(proposal?.updatedParams.promptDirectives).toContain(
        'maximize-action-jitter-and-strict-anti-fingerprinting'
      );
    });

    it('should optimize parameters on highly efficient successful tasks', () => {
      const metric: TaskExecutionMetric = {
        taskId: 'task_004',
        domain: 'fast-api.com',
        steps: 2,
        durationMs: 3500,
        success: true,
      };

      const proposal = optimizer.recordTaskOutcome(metric);
      expect(proposal).not.toBeNull();
      // Risk aversion increases slightly from 0.5 to 0.52 (more confident)
      expect(proposal?.updatedParams.riskAversionFactor).toBe(0.52);
      // Token budget safely trimmed from 3000 to 2850
      expect(proposal?.updatedParams.tokenBudget).toBe(2850);

      const persisted = repo.getParams('fast-api.com');
      expect(persisted?.sampleCount).toBe(1);
      expect(persisted?.successCount).toBe(1);
    });

    it('should synthesize archetype parameters by averaging domain parameters', () => {
      // Seed 2 domains under ecommerce
      repo.saveParams({
        id: 'p_d1',
        domainOrArchetype: 'shop1.com',
        riskAversionFactor: 0.4,
        maxRetries: 4,
        tokenBudget: 3200,
        frustrationThreshold: 4,
        promptDirectives: ['dismiss-modals', 'common-rule'],
        sampleCount: 5,
        successCount: 4,
        updatedAt: new Date().toISOString(),
      });

      repo.saveParams({
        id: 'p_d2',
        domainOrArchetype: 'shop2.com',
        riskAversionFactor: 0.6,
        maxRetries: 6,
        tokenBudget: 3600,
        frustrationThreshold: 4,
        promptDirectives: ['prefer-exact-text', 'common-rule'],
        sampleCount: 5,
        successCount: 4,
        updatedAt: new Date().toISOString(),
      });

      const archetypeParams = optimizer.synchronizeArchetypeParams('ecommerce', [
        'shop1.com',
        'shop2.com',
      ]);

      expect(archetypeParams.domainOrArchetype).toBe('ecommerce');
      expect(archetypeParams.riskAversionFactor).toBe(0.5); // (0.4 + 0.6) / 2
      expect(archetypeParams.maxRetries).toBe(5); // round((4 + 6) / 2)
      expect(archetypeParams.tokenBudget).toBe(3400); // round((3200 + 3600) / 2)
      expect(archetypeParams.frustrationThreshold).toBe(4);
      expect(archetypeParams.promptDirectives).toContain('dismiss-modals');
      expect(archetypeParams.promptDirectives).toContain('prefer-exact-text');
      expect(archetypeParams.promptDirectives).toContain('common-rule');

      // Check persisted
      const savedArchetype = repo.getParams('ecommerce');
      expect(savedArchetype).not.toBeNull();
      expect(savedArchetype?.tokenBudget).toBe(3400);
    });
  });

  describe('ReasoningStage Meta-Optimization Directive Injection', () => {
    it('should inject meta-optimized directives into workingMemoryFacts during planning/reasoning', async () => {
      // Seed domain hyperparameters with directives
      repo.saveParams({
        id: 'param_fin_domain',
        domainOrArchetype: 'banking.example.com',
        riskAversionFactor: 0.85,
        maxRetries: 3,
        tokenBudget: 3500,
        frustrationThreshold: 3,
        promptDirectives: [
          'prefer-semantic-locators-and-wait-for-dom-settle',
          'verify-account-balance-before-transfer',
        ],
        sampleCount: 10,
        successCount: 9,
        updatedAt: new Date().toISOString(),
      });

      let capturedPromptContext: any;
      const mockPromptBuilder = {
        buildMessages: vi.fn().mockImplementation((ctx) => {
          capturedPromptContext = ctx;
          return [{ role: 'user', content: 'test prompt' }];
        }),
      } as any;

      const mockLLM: LLMProvider = {
        generateDecision: vi.fn().mockResolvedValue({
          status: 'complete',
          reasoning_summary: 'Guided by meta-optimized rules',
          finalFindings: [],
        }),
      };

      const mockBrowserManager = {
        getTabManager: () => ({
          listTabs: () => [{ id: 'tab_001', url: 'https://banking.example.com/accounts', title: 'Accounts' }],
        }),
        getTabBranchManager: () => ({
          getActiveBranches: () => [],
        }),
      } as any;

      const stage = new ReasoningStage({
        browserManager: mockBrowserManager,
        promptBuilder: mockPromptBuilder,
        llmProvider: mockLLM,
        planner: { formatPlanSummary: () => 'Banking plan' } as any,
        recoveryManager: { getPromptWarnings: () => [], clear: vi.fn() } as any,
        memoryManager: { formatMemoryForPrompt: () => [] } as any,
        stateMachine: { transitionTo: vi.fn() } as any,
        logger,
        persistFindings: vi.fn(),
        recordSuccessfulPlaybook: vi.fn(),
        metaOptimizer: optimizer,
        hyperparameterRepo: repo,
        buildResult: vi.fn().mockReturnValue({ taskId: 't1', status: 'completed', steps: 1, durationMs: 10, summary: 'done' }),
      });

      const snapshot: PageSnapshot = {
        url: 'https://banking.example.com/accounts',
        title: 'Banking Portal',
        activeTabId: 'tab_001',
        compressedObservationText: 'Banking account overview',
        pageSummary: { headings: [], forms: [], links: [], notices: [] },
        interactiveElements: [],
        timestamp: new Date().toISOString(),
      };

      await stage.execute({
        task: { id: 'task_bank_1', goal: 'Check account summary' },
        stepCount: 1,
        startTime: Date.now(),
        maxSteps: 5,
        maxDurationMs: 60000,
        sources: [],
        recentActions: [],
        plan: { goal: 'Check account summary', milestones: [], currentMilestoneIndex: 0, lastUpdated: new Date().toISOString() },
        frustrationMonitor: { getFrustrationLevel: () => ({ level: 'low' }) } as any,
        processedDownloadIds: new Set(),
        currentSnapshot: snapshot,
        activePage: { url: () => 'https://banking.example.com/accounts' } as any,
      });

      expect(capturedPromptContext).toBeDefined();
      const facts = capturedPromptContext?.workingMemoryFacts as string[];
      expect(facts).toBeDefined();
      expect(
        facts.some((f) => f.includes('[META-OPTIMIZED DIRECTIVE]: prefer-semantic-locators-and-wait-for-dom-settle'))
      ).toBe(true);
      expect(
        facts.some((f) => f.includes('[META-OPTIMIZED DIRECTIVE]: verify-account-balance-before-transfer'))
      ).toBe(true);
    });
  });
});

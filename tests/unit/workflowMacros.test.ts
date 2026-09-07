import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteDatabase } from '../../src/persistence/Database.js';
import { WorkflowMacroRepository } from '../../src/persistence/WorkflowMacroRepository.js';
import { MacroSynthesizer } from '../../src/macros/MacroSynthesizer.js';
import { SelfHealingPipeline } from '../../src/macros/SelfHealingPipeline.js';
import { MacroExecutor } from '../../src/macros/MacroExecutor.js';
import { ElementRegistry } from '../../src/observer/ElementRegistry.js';
import type { WorkflowMacro, ParameterizedMacroStep } from '../../src/macros/types.js';
import type { BrowserAction } from '../../src/actions/Action.js';
import type { ActionRegistry } from '../../src/actions/ActionRegistry.js';
import type { PageObserver } from '../../src/observer/PageObserver.js';
import type { BrowserManager } from '../../src/browser/BrowserManager.js';
import { Logger } from '../../src/logging/Logger.js';
import type { LLMProvider } from '../../src/llm/LLM.js';

describe('Phase 32: Workflow Macros & Self-Healing Action Pipelines', () => {
  let db: SqliteDatabase;
  let macroRepo: WorkflowMacroRepository;
  let logger: Logger;

  beforeEach(() => {
    db = new SqliteDatabase({ path: ':memory:' });
    macroRepo = new WorkflowMacroRepository(db);
    logger = new Logger('error');
  });

  afterEach(() => {
    db.close();
  });

  describe('WorkflowMacroRepository', () => {
    it('should save and retrieve a macro by ID', () => {
      const macro: WorkflowMacro = {
        id: 'macro_example_com_search',
        domain: 'example.com',
        intentKey: 'catalog_search',
        parameterKeys: ['query'],
        steps: [
          {
            stepNumber: 1,
            actionTemplate: { type: 'fill', targetId: 'el_input', value: '{{query}}' },
            primaryTargetRole: 'textbox',
            primaryTargetName: 'Search',
          },
          {
            stepNumber: 2,
            actionTemplate: { type: 'click', targetId: 'el_btn' },
            primaryTargetRole: 'button',
            primaryTargetName: 'Search',
          },
        ],
        status: 'provisional',
        successCount: 1,
        failureCount: 0,
        healingCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      macroRepo.saveMacro(macro);

      const retrieved = macroRepo.getMacroById('macro_example_com_search');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(macro.id);
      expect(retrieved?.domain).toBe('example.com');
      expect(retrieved?.steps.length).toBe(2);
      expect(retrieved?.parameterKeys).toEqual(['query']);
    });

    it('should find macro by domain and intent key, preferring verified over provisional', () => {
      const provisionalMacro: WorkflowMacro = {
        id: 'macro_prov',
        domain: 'test.org',
        intentKey: 'login',
        parameterKeys: [],
        steps: [],
        status: 'provisional',
        successCount: 1,
        failureCount: 0,
        healingCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const verifiedMacro: WorkflowMacro = {
        id: 'macro_verif',
        domain: 'test.org',
        intentKey: 'login',
        parameterKeys: [],
        steps: [],
        status: 'verified',
        successCount: 5,
        failureCount: 0,
        healingCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      macroRepo.saveMacro(provisionalMacro);
      macroRepo.saveMacro(verifiedMacro);

      const found = macroRepo.findMacro('test.org', 'login');
      expect(found).not.toBeNull();
      expect(found?.id).toBe('macro_verif');
      expect(found?.status).toBe('verified');
    });

    it('should promote provisional macro to verified upon repeated successes', () => {
      const macro: WorkflowMacro = {
        id: 'macro_promo',
        domain: 'promo.com',
        intentKey: 'checkout',
        parameterKeys: [],
        steps: [],
        status: 'provisional',
        successCount: 1,
        failureCount: 0,
        healingCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      macroRepo.saveMacro(macro);
      macroRepo.recordSuccess('macro_promo');

      const updated = macroRepo.getMacroById('macro_promo');
      expect(updated?.successCount).toBe(2);
      expect(updated?.status).toBe('verified');
    });

    it('should degrade macro upon 3 consecutive failures', () => {
      const macro: WorkflowMacro = {
        id: 'macro_fail',
        domain: 'fail.com',
        intentKey: 'action',
        parameterKeys: [],
        steps: [],
        status: 'verified',
        successCount: 10,
        failureCount: 0,
        healingCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      macroRepo.saveMacro(macro);
      macroRepo.recordFailure('macro_fail');
      macroRepo.recordFailure('macro_fail');
      macroRepo.recordFailure('macro_fail');

      const updated = macroRepo.getMacroById('macro_fail');
      expect(updated?.failureCount).toBe(3);
      expect(updated?.status).toBe('degraded');
    });

    it('should track healing count and updated step data', () => {
      const macro: WorkflowMacro = {
        id: 'macro_heal',
        domain: 'heal.com',
        intentKey: 'heal_intent',
        parameterKeys: [],
        steps: [
          {
            stepNumber: 1,
            actionTemplate: { type: 'click', targetId: 'old_btn' },
            primaryTargetRole: 'button',
            primaryTargetName: 'Submit',
          },
        ],
        status: 'verified',
        successCount: 3,
        failureCount: 0,
        healingCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      macroRepo.saveMacro(macro);

      const updatedSteps: ParameterizedMacroStep[] = [
        {
          stepNumber: 1,
          actionTemplate: { type: 'click', targetId: 'new_btn' },
          primaryTargetRole: 'button',
          primaryTargetName: 'Submit',
        },
      ];

      macroRepo.recordHealing('macro_heal', updatedSteps);

      const updated = macroRepo.getMacroById('macro_heal');
      expect(updated?.healingCount).toBe(1);
      expect(updated?.lastHealedAt).toBeTruthy();
      expect((updated?.steps[0].actionTemplate as { targetId: string }).targetId).toBe('new_btn');
    });
  });

  describe('MacroSynthesizer', () => {
    let synthesizer: MacroSynthesizer;

    beforeEach(() => {
      synthesizer = new MacroSynthesizer(macroRepo, logger);
    });

    it('should extract parametric query intent from search goals', () => {
      const res1 = synthesizer.extractIntent('Search for wireless mechanical keyboards');
      expect(res1.intentKey).toBe('catalog_search');
      expect(res1.isParametric).toBe(true);
      expect(res1.parameters.query).toBe('wireless mechanical keyboards');

      const res2 = synthesizer.extractIntent('Find information on iPhone 16 Pro');
      expect(res2.intentKey).toBe('catalog_search');
      expect(res2.parameters.query).toBe('iPhone 16 Pro');
    });

    it('should extract login and checkout intents', () => {
      const login = synthesizer.extractIntent('Log in to the customer portal');
      expect(login.intentKey).toBe('account_login');
      expect(login.isParametric).toBe(false);

      const checkout = synthesizer.extractIntent('Proceed to checkout and place order');
      expect(checkout.intentKey).toBe('cart_checkout');
      expect(checkout.isParametric).toBe(false);
    });

    it('should synthesize parameterized macro steps from trajectory and element registry', () => {
      const registry = new ElementRegistry();
      // Simulate registered elements
      (registry as unknown as { elements: Map<string, unknown> }).elements = new Map([
        [
          'el_input_1',
          {
            id: 'el_input_1',
            role: 'searchbox',
            name: 'Search catalog',
            locatorStrategy: { selector: 'input[name="q"]' },
          },
        ],
        [
          'el_submit_1',
          {
            id: 'el_submit_1',
            role: 'button',
            name: 'Search',
            locatorStrategy: { selector: 'button.btn-search' },
          },
        ],
      ]);

      const executedActions: BrowserAction[] = [
        { type: 'fill', id: 'act_1', targetId: 'el_input_1', value: 'ergonomic chair' },
        { type: 'click', id: 'act_2', targetId: 'el_submit_1' },
      ];

      const macro = synthesizer.synthesizeFromTrajectory(
        { id: 'task_01', goal: 'Search for ergonomic chair' },
        'furnishings.com',
        executedActions,
        { elementRegistry: registry }
      );

      expect(macro).not.toBeNull();
      expect(macro?.domain).toBe('furnishings.com');
      expect(macro?.intentKey).toBe('catalog_search');
      expect(macro?.parameterKeys).toContain('query');
      expect(macro?.steps.length).toBe(2);

      // Value was parameterized to {{query}}
      expect((macro?.steps[0].actionTemplate as { value: string }).value).toBe('{{query}}');
      expect(macro?.steps[0].primaryTargetRole).toBe('searchbox');
      expect(macro?.steps[0].primaryTargetName).toBe('Search catalog');
      expect(macro?.steps[0].fallbackSelectors).toContain('input[name="q"]');

      // Macro was persisted into database
      const persisted = macroRepo.getMacroById(macro!.id);
      expect(persisted).not.toBeNull();
    });

    it('should reject macro synthesis for destructive actions', () => {
      const actions: BrowserAction[] = [
        { type: 'navigate', id: 'act_nav', url: 'https://admin.com', waitUntil: 'load' },
        { type: 'close_tab', id: 'act_close', tabId: 'tab_001' },
      ];

      const macro = synthesizer.synthesizeFromTrajectory(
        { id: 'task_dest', goal: 'Search for records' },
        'admin.com',
        actions
      );

      expect(macro).toBeNull();
    });
  });

  describe('SelfHealingPipeline', () => {
    it('should heal missing element via Tier 1 Semantic Heuristic Matching', async () => {
      const pipeline = new SelfHealingPipeline(macroRepo, undefined, logger);
      const registry = new ElementRegistry();

      // Original target was el_old, role: "button", name: "Checkout Now"
      // New DOM has el_new, role: "button", name: "Checkout Now"
      (registry as unknown as { elements: Map<string, unknown> }).elements = new Map([
        [
          'el_other',
          { id: 'el_other', role: 'textbox', name: 'Promo Code' },
        ],
        [
          'el_new',
          { id: 'el_new', role: 'button', name: 'Checkout Now' },
        ],
      ]);

      const macro: WorkflowMacro = {
        id: 'macro_heal_test',
        domain: 'store.com',
        intentKey: 'cart_checkout',
        parameterKeys: [],
        steps: [
          {
            stepNumber: 1,
            actionTemplate: { type: 'click', targetId: 'el_old' },
            primaryTargetRole: 'button',
            primaryTargetName: 'Checkout Now',
            primaryTargetId: 'el_old',
          },
        ],
        status: 'verified',
        successCount: 5,
        failureCount: 0,
        healingCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      macroRepo.saveMacro(macro);

      const healResult = await pipeline.healStep(macro, 0, registry);
      expect(healResult.healed).toBe(true);
      expect(healResult.tierUsed).toBe('heuristic');
      expect(healResult.repairedTargetId).toBe('el_new');
      expect((healResult.updatedStep?.actionTemplate as { targetId: string }).targetId).toBe('el_new');

      // Verify SQLite was hot-patched
      const updatedMacro = macroRepo.getMacroById('macro_heal_test');
      expect(updatedMacro?.healingCount).toBe(1);
      expect((updatedMacro?.steps[0].actionTemplate as { targetId: string }).targetId).toBe('el_new');
    });

    it('should heal missing element via Tier 2 LLM Micro-Repair when heuristics are ambiguous', async () => {
      const mockLLM: LLMProvider = {
        generateDecision: vi.fn(),
        generateResponse: vi.fn().mockResolvedValue({
          rawText: JSON.stringify({ repairedTargetId: 'el_dynamic_99', confidence: 0.95 }),
        }),
      };

      const pipeline = new SelfHealingPipeline(macroRepo, mockLLM, logger);
      const registry = new ElementRegistry();

      // Elements without exact name match
      (registry as unknown as { elements: Map<string, unknown> }).elements = new Map([
        [
          'el_dynamic_99',
          { id: 'el_dynamic_99', role: 'link', name: 'Finish Your Order' },
        ],
      ]);

      const macro: WorkflowMacro = {
        id: 'macro_llm_heal',
        domain: 'store.com',
        intentKey: 'cart_checkout',
        parameterKeys: [],
        steps: [
          {
            stepNumber: 1,
            actionTemplate: { type: 'click', targetId: 'el_vanished' },
            primaryTargetRole: 'button',
            primaryTargetName: 'Proceed to Payment',
            primaryTargetId: 'el_vanished',
          },
        ],
        status: 'provisional',
        successCount: 1,
        failureCount: 0,
        healingCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      macroRepo.saveMacro(macro);

      const healResult = await pipeline.healStep(macro, 0, registry);
      expect(healResult.healed).toBe(true);
      expect(healResult.tierUsed).toBe('llm');
      expect(healResult.repairedTargetId).toBe('el_dynamic_99');
    });

    it('should return healed: false if no suitable replacement element exists', async () => {
      const pipeline = new SelfHealingPipeline(macroRepo, undefined, logger);
      const registry = new ElementRegistry();

      (registry as unknown as { elements: Map<string, unknown> }).elements = new Map([
        ['el_textbox', { id: 'el_textbox', role: 'textbox', name: 'Email' }],
      ]);

      const macro: WorkflowMacro = {
        id: 'macro_no_heal',
        domain: 'store.com',
        intentKey: 'cart_checkout',
        parameterKeys: [],
        steps: [
          {
            stepNumber: 1,
            actionTemplate: { type: 'click', targetId: 'el_btn' },
            primaryTargetRole: 'button',
            primaryTargetName: 'Submit Order',
          },
        ],
        status: 'provisional',
        successCount: 1,
        failureCount: 0,
        healingCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const healResult = await pipeline.healStep(macro, 0, registry);
      expect(healResult.healed).toBe(false);
      expect(healResult.tierUsed).toBe('none');
    });
  });

  describe('MacroExecutor', () => {
    it('should deterministically execute macro steps with parameter interpolation', async () => {
      const executedDispatches: BrowserAction[] = [];

      const mockActionRegistry = {
        dispatch: vi.fn().mockImplementation(async (action: BrowserAction) => {
          executedDispatches.push(action);
          return { success: true };
        }),
      } as unknown as ActionRegistry;

      const mockPageObserver = {
        observePage: vi.fn().mockResolvedValue({}),
        getRegistry: vi.fn().mockReturnValue(new ElementRegistry()),
      } as unknown as PageObserver;

      const mockBrowserManager = {} as unknown as BrowserManager;
      const healingPipeline = new SelfHealingPipeline(macroRepo, undefined, logger);

      const executor = new MacroExecutor({
        browserManager: mockBrowserManager,
        actionRegistry: mockActionRegistry,
        pageObserver: mockPageObserver,
        macroRepo,
        healingPipeline,
        logger,
      });

      const macro: WorkflowMacro = {
        id: 'macro_exec_test',
        domain: 'search.io',
        intentKey: 'catalog_search',
        parameterKeys: ['query'],
        steps: [
          {
            stepNumber: 1,
            actionTemplate: { type: 'fill', targetId: 'inp_1', value: '{{query}}' },
          },
          {
            stepNumber: 2,
            actionTemplate: { type: 'click', targetId: 'btn_1' },
          },
        ],
        status: 'verified',
        successCount: 5,
        failureCount: 0,
        healingCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      macroRepo.saveMacro(macro);

      const mockPage = {} as unknown as import('playwright-core').Page;
      const result = await executor.executeMacro(
        macro,
        { query: 'wireless headphones' },
        { page: mockPage, tabId: 'tab_001', taskId: 'task_exec' }
      );

      expect(result.success).toBe(true);
      expect(result.executedSteps).toBe(2);
      expect(executedDispatches.length).toBe(2);
      expect((executedDispatches[0] as { value: string }).value).toBe('wireless headphones');
    });

    it('should in-flight self-heal when an element target has moved and continue execution', async () => {
      let dispatchCount = 0;
      const registry = new ElementRegistry();
      (registry as unknown as { elements: Map<string, unknown> }).elements = new Map([
        ['btn_healed', { id: 'btn_healed', role: 'button', name: 'Confirm Purchase' }],
      ]);

      const mockActionRegistry = {
        dispatch: vi.fn().mockImplementation(async (action: BrowserAction) => {
          dispatchCount++;
          if (dispatchCount === 1) {
            // First step fails because targetId 'btn_broken' does not exist
            return {
              success: false,
              error: new Error('Element btn_broken not found in DOM'),
            };
          }
          // After healing to btn_healed, dispatch succeeds
          return { success: true };
        }),
      } as unknown as ActionRegistry;

      const mockPageObserver = {
        observePage: vi.fn().mockResolvedValue({}),
        getRegistry: vi.fn().mockReturnValue(registry),
      } as unknown as PageObserver;

      const healingPipeline = new SelfHealingPipeline(macroRepo, undefined, logger);

      const executor = new MacroExecutor({
        browserManager: {} as unknown as BrowserManager,
        actionRegistry: mockActionRegistry,
        pageObserver: mockPageObserver,
        macroRepo,
        healingPipeline,
        logger,
        maxHealingAttemptsPerStep: 2,
      });

      const macro: WorkflowMacro = {
        id: 'macro_heal_retry',
        domain: 'checkout.com',
        intentKey: 'cart_checkout',
        parameterKeys: [],
        steps: [
          {
            stepNumber: 1,
            actionTemplate: { type: 'click', targetId: 'btn_broken' },
            primaryTargetRole: 'button',
            primaryTargetName: 'Confirm Purchase',
            primaryTargetId: 'btn_broken',
          },
        ],
        status: 'provisional',
        successCount: 1,
        failureCount: 0,
        healingCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      macroRepo.saveMacro(macro);

      const mockPage = {} as unknown as import('playwright-core').Page;
      const result = await executor.executeMacro(
        macro,
        {},
        { page: mockPage, tabId: 'tab_001', taskId: 'task_heal' }
      );

      expect(result.success).toBe(true);
      expect(result.executedSteps).toBe(1);
      expect(result.healedCount).toBe(1);
    });
  });

  describe('AgentLoop Macro Fast-Path Integration', () => {
    it('should execute fast-path and bypass LLM reasoning when verified macro matches', async () => {
      const { AgentLoop } = await import('../../src/agent/AgentLoop.js');

      const mockPage = {
        url: () => 'https://store.acme.com/search',
        title: async () => 'Acme Store',
      };

      const mockBrowserManager = {
        getPageManager: () => ({
          getActivePage: () => mockPage,
        }),
        getTabManager: () => ({
          getActiveTab: () => ({ id: 'tab_001' }),
        }),
        getContext: () => null,
      } as unknown as BrowserManager;

      const mockLLM: LLMProvider = {
        generateDecision: vi.fn(),
      };

      const mockPageObserver = {
        observePage: vi.fn().mockResolvedValue({}),
        getRegistry: vi.fn().mockReturnValue(new ElementRegistry()),
      } as unknown as PageObserver;

      const mockActionRegistry = {
        dispatch: vi.fn(),
      } as unknown as ActionRegistry;

      const mockMacroExecutor = {
        executeMacro: vi.fn().mockResolvedValue({
          success: true,
          macroId: 'macro_store_acme_com_catalog_search',
          executedSteps: 4,
          healedCount: 1,
          durationMs: 80,
        }),
      } as unknown as MacroExecutor;

      const macro: WorkflowMacro = {
        id: 'macro_store_acme_com_catalog_search',
        domain: 'store.acme.com',
        intentKey: 'catalog_search',
        parameterKeys: ['query'],
        steps: [],
        status: 'verified',
        successCount: 10,
        failureCount: 0,
        healingCount: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      macroRepo.saveMacro(macro);

      const loop = new AgentLoop({
        browserManager: mockBrowserManager,
        actionRegistry: mockActionRegistry,
        pageObserver: mockPageObserver,
        llmProvider: mockLLM,
        logger,
        config: {
          screenshotDir: 'data/test',
          maxAgentSteps: 10,
          maxTaskDurationMs: 60000,
        } as any,
        database: db,
        macroRepo,
        macroExecutor: mockMacroExecutor,
      });

      vi.spyOn(loop.getTrajectoryReflector(), 'reflectOnTask').mockResolvedValue(undefined as any);

      const result = await loop.run({
        id: 'task_fast_path',
        goal: 'Search for mechanical keyboard',
      });

      expect(result.status).toBe('completed');
      expect(result.steps).toBe(4);
      expect(result.summary).toContain('fast-path macro');
      expect(mockMacroExecutor.executeMacro).toHaveBeenCalled();
      // LLM was completely bypassed (System 1 fast-path)
      expect(mockLLM.generateDecision).not.toHaveBeenCalled();
    });

    it('should fallback to deliberative reasoning when fast-path macro execution fails', async () => {
      const { AgentLoop } = await import('../../src/agent/AgentLoop.js');

      const mockPage = {
        url: () => 'https://store.acme.com/search',
        title: async () => 'Acme Store',
        evaluate: vi.fn().mockResolvedValue(undefined),
      };

      const mockBrowserManager = {
        getPageManager: () => ({
          getActivePage: () => mockPage,
        }),
        getTabManager: () => ({
          getActiveTab: () => ({ id: 'tab_001' }),
          listTabs: () => [{ id: 'tab_001', url: 'https://store.acme.com/search', title: 'Acme Store' }],
        }),
        getTabBranchManager: () => ({
          getActiveBranches: () => [],
        }),
        getContext: () => null,
      } as unknown as BrowserManager;

      const mockLLM: LLMProvider = {
        generateDecision: vi.fn().mockResolvedValue({
          status: 'complete',
          reasoning_summary: 'Deliberative reasoning solved the task after macro failure.',
          finalFindings: [{ claim: 'Item found', sourceUrls: ['https://store.acme.com/search'] }],
        }),
      };

      const mockPageObserver = {
        observePage: vi.fn().mockResolvedValue({
          url: 'https://store.acme.com/search',
          activeTabId: 'tab_001',
          compressedObservationText: 'Page content',
          interactiveElements: [],
        }),
        getRegistry: vi.fn().mockReturnValue(new ElementRegistry()),
      } as unknown as PageObserver;

      const mockActionRegistry = {
        dispatch: vi.fn(),
      } as unknown as ActionRegistry;

      const mockMacroExecutor = {
        executeMacro: vi.fn().mockResolvedValue({
          success: false,
          macroId: 'macro_store_acme_com_catalog_search',
          executedSteps: 1,
          healedCount: 0,
          failedStepIndex: 1,
          error: new Error('Button click failed after DOM mutation'),
          durationMs: 30,
        }),
      } as unknown as MacroExecutor;

      const macro: WorkflowMacro = {
        id: 'macro_store_acme_com_catalog_search',
        domain: 'store.acme.com',
        intentKey: 'catalog_search',
        parameterKeys: ['query'],
        steps: [],
        status: 'verified',
        successCount: 10,
        failureCount: 0,
        healingCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      macroRepo.saveMacro(macro);

      const loop = new AgentLoop({
        browserManager: mockBrowserManager,
        actionRegistry: mockActionRegistry,
        pageObserver: mockPageObserver,
        llmProvider: mockLLM,
        logger,
        config: {
          screenshotDir: 'data/test',
          maxAgentSteps: 10,
          maxTaskDurationMs: 60000,
        } as any,
        database: db,
        macroRepo,
        macroExecutor: mockMacroExecutor,
      });

      const result = await loop.run({
        id: 'task_fallback',
        goal: 'Search for mechanical keyboard',
      });

      expect(result.status).toBe('completed');
      expect(result.summary).toBe('Deliberative reasoning solved the task after macro failure.');
      expect(mockMacroExecutor.executeMacro).toHaveBeenCalled();
      // LLM reasoning was invoked as graceful fallback
      expect(mockLLM.generateDecision).toHaveBeenCalled();
    });
  });
});


import { describe, it, expect, beforeEach } from 'vitest';
import { ActionRiskEvaluator } from '../../src/agent/ActionRiskEvaluator.js';
import { ElementRegistry } from '../../src/observer/ElementRegistry.js';
import { validateDecision, safeValidateDecision, type ActionCandidate } from '../../src/llm/schemas.js';
import type { BrowserAction } from '../../src/actions/Action.js';
import { ReasoningStage } from '../../src/agent/pipeline/ReasoningStage.js';
import { FrustrationMonitor } from '../../src/agent/FrustrationMonitor.js';
import { AgentStateMachine } from '../../src/agent/AgentState.js';
import { MemoryManager } from '../../src/memory/MemoryManager.js';
import { Logger } from '../../src/logging/Logger.js';
import { EventLogger } from '../../src/logging/EventLogger.js';
import type { Page } from 'playwright-core';
import type { LoopIterationContext } from '../../src/agent/pipeline/types.js';
import type { PageSnapshot } from '../../src/observer/PageSnapshot.js';
import type { BrowserManager } from '../../src/browser/BrowserManager.js';
import type { PageObserver } from '../../src/observer/PageObserver.js';
import type { PromptBuilder } from '../../src/llm/PromptBuilder.js';
import type { LLMProvider } from '../../src/llm/LLM.js';
import type { Planner } from '../../src/agent/Planner.js';
import type { RecoveryManager } from '../../src/agent/RecoveryManager.js';
import type { AgentResult } from '../../src/agent/Agent.js';

describe('Phase 31: ActionRiskEvaluator & Speculative Candidate Sampling', () => {
  let riskEvaluator: ActionRiskEvaluator;
  let registry: ElementRegistry;

  beforeEach(() => {
    riskEvaluator = new ActionRiskEvaluator();
    registry = new ElementRegistry();
  });

  describe('Single Action Empirical Risk Assessment', () => {
    it('should classify read-only actions as safe with 0.0 risk score', () => {
      const actions: BrowserAction[] = [
        { id: 'a1', type: 'screenshot', fullPage: false },
        { id: 'a2', type: 'scroll', direction: 'down', amount: 500 },
        { id: 'a3', type: 'wait', condition: 'timeout', timeoutMs: 1000 },
        { id: 'a4', type: 'extract', instruction: 'Extract text' },
        { id: 'a5', type: 'harvest_network_payload', urlPattern: '/api/v1', destination: 'working', maxItems: 10 },
      ];

      for (const action of actions) {
        const assessment = riskEvaluator.assessActionRisk(action);
        expect(assessment.riskLevel).toBe('safe');
        expect(assessment.riskScore).toBe(0.0);
        expect(assessment.isIrreversible).toBe(false);
      }
    });

    it('should classify branch_tab and switch_tab as safe exploratory actions', () => {
      const branchAction: BrowserAction = {
        id: 'a_branch',
        type: 'branch_tab',
        url: 'https://store.local/test',
        branchGoal: 'Test speculative coupon',
      };
      const switchAction: BrowserAction = {
        id: 'a_switch',
        type: 'switch_tab',
        tabId: 'tab_002',
      };

      const branchAssessment = riskEvaluator.assessActionRisk(branchAction);
      expect(branchAssessment.riskLevel).toBe('safe');
      expect(branchAssessment.riskScore).toBeLessThanOrEqual(0.1);

      const switchAssessment = riskEvaluator.assessActionRisk(switchAction);
      expect(switchAssessment.riskLevel).toBe('safe');
      expect(switchAssessment.riskScore).toBeLessThanOrEqual(0.1);
    });

    it('should classify close_tab on sole open tab as destructive, but caution when multiple tabs open', () => {
      const closeAction: BrowserAction = { id: 'a_close', type: 'close_tab', tabId: 'tab_001' };

      // Sole tab open
      const soleTabAssessment = riskEvaluator.assessActionRisk(closeAction, { openTabsCount: 1 });
      expect(soleTabAssessment.riskLevel).toBe('destructive');
      expect(soleTabAssessment.riskScore).toBeGreaterThanOrEqual(0.8);
      expect(soleTabAssessment.isIrreversible).toBe(true);

      // Multiple tabs open
      const multiTabAssessment = riskEvaluator.assessActionRisk(closeAction, { openTabsCount: 3 });
      expect(multiTabAssessment.riskLevel).toBe('caution');
      expect(multiTabAssessment.riskScore).toBeLessThan(0.5);
    });

    it('should detect destructive deletions and cancellations on click targets', () => {
      const deleteButtonId = registry.register({
        role: 'button',
        name: 'Delete Project Forever',
        locatorStrategy: { type: 'role', selector: 'button' },
      });

      const clickAction: BrowserAction = {
        id: 'a_click_del',
        type: 'click',
        targetId: deleteButtonId,
      };

      const assessment = riskEvaluator.assessActionRisk(clickAction, { elementRegistry: registry });
      expect(assessment.riskLevel).toBe('destructive');
      expect(assessment.riskScore).toBe(0.95);
      expect(assessment.isIrreversible).toBe(true);
      expect(assessment.recommendedMitigation).toContain('branch_tab');
    });

    it('should detect irreversible payment and financial mutations', () => {
      const payButtonId = registry.register({
        role: 'button',
        name: 'Confirm Payment & Place Order',
        locatorStrategy: { type: 'role', selector: 'button' },
      });

      const payAction: BrowserAction = {
        id: 'a_pay',
        type: 'click',
        targetId: payButtonId,
      };

      const assessment = riskEvaluator.assessActionRisk(payAction, { elementRegistry: registry });
      expect(assessment.riskLevel).toBe('destructive');
      expect(assessment.riskScore).toBe(0.90);
      expect(assessment.isIrreversible).toBe(true);
    });

    it('should detect state mutations as high_risk', () => {
      const submitId = registry.register({
        role: 'button',
        name: 'Save Changes & Update Profile',
        locatorStrategy: { type: 'role', selector: 'button' },
      });

      const submitAction: BrowserAction = {
        id: 'a_submit',
        type: 'click',
        targetId: submitId,
      };

      const assessment = riskEvaluator.assessActionRisk(submitAction, { elementRegistry: registry });
      expect(assessment.riskLevel).toBe('high_risk');
      expect(assessment.riskScore).toBe(0.60);
      expect(assessment.isIrreversible).toBe(false);
    });

    it('should flag credit card / sensitive input text as high_risk', () => {
      const cardAction: BrowserAction = {
        id: 'a_fill_card',
        type: 'fill',
        targetId: 'el_card',
        value: '4532 1198 2341 9021',
      };

      const assessment = riskEvaluator.assessActionRisk(cardAction);
      expect(assessment.riskLevel).toBe('high_risk');
      expect(assessment.riskScore).toBe(0.70);
    });
  });

  describe('Speculative Candidate Evaluation & Ranking (Best-of-N)', () => {
    it('should rank safe high-confidence actions above destructive actions', () => {
      const deleteTargetId = registry.register({
        role: 'button',
        name: 'Purge Entire Repository',
        locatorStrategy: { type: 'role', selector: 'button' },
      });

      const inspectTargetId = registry.register({
        role: 'link',
        name: 'View Details & Inspection',
        locatorStrategy: { type: 'role', selector: 'link' },
      });

      const candidates: ActionCandidate[] = [
        {
          action: { id: 'c1', type: 'click', targetId: deleteTargetId },
          reasoning: 'Directly delete without verification',
          confidence: 0.95, // High confidence but destructive!
        },
        {
          action: { id: 'c2', type: 'click', targetId: inspectTargetId },
          reasoning: 'Inspect settings first before deciding',
          confidence: 0.90, // Safe link navigation
        },
        {
          action: { id: 'c3', type: 'screenshot', fullPage: false },
          reasoning: 'Capture snapshot for confirmation',
          confidence: 0.85, // Completely safe read-only
        },
      ];

      const ranked = riskEvaluator.evaluateCandidates(candidates, {
        elementRegistry: registry,
        riskAversionFactor: 0.5,
      });

      expect(ranked.length).toBe(3);

      // Candidate 3 (screenshot, utility 0.85) and Candidate 2 (inspectTargetId, utility 0.8325) should outrank Candidate 1 (destructive, utility 0.498)
      const topCandidate = ranked[0];
      expect(topCandidate.candidate.action.id).toBe('c3');
      expect(topCandidate.rank).toBe(1);

      const secondCandidate = ranked[1];
      expect(secondCandidate.candidate.action.id).toBe('c2');
      expect(secondCandidate.rank).toBe(2);

      const lastCandidate = ranked[2];
      expect(lastCandidate.candidate.action.id).toBe('c1');
      expect(lastCandidate.assessment.riskLevel).toBe('destructive');
      expect(lastCandidate.rank).toBe(3);

      const best = riskEvaluator.selectBestCandidate(candidates, { elementRegistry: registry });
      expect(best).toBeDefined();
      expect(best?.candidate.action.id).toBe('c3');
    });

    it('should return undefined when candidate list is empty', () => {
      const best = riskEvaluator.selectBestCandidate([]);
      expect(best).toBeUndefined();
    });
  });

  describe('Decision Schema with Candidates Support', () => {
    it('should validate LLMDecision with speculative action candidates', () => {
      const decisionData = {
        status: 'continue',
        reasoning_summary: 'Choosing safest path among candidates',
        actions: [{ type: 'screenshot', fullPage: false }],
        candidates: [
          {
            action: { type: 'screenshot', fullPage: false },
            reasoning: 'Safe observation',
            confidence: 0.9,
            riskScore: 0.0,
          },
          {
            action: { type: 'click', targetId: 'el_001' },
            reasoning: 'Direct click',
            confidence: 0.75,
            riskScore: 0.3,
          },
        ],
        expectedOutcome: 'Observation captured',
      };

      const validated = validateDecision(decisionData);
      expect(validated.candidates).toBeDefined();
      expect(validated.candidates?.length).toBe(2);
      expect(validated.candidates?.[0].confidence).toBe(0.9);

      const safeResult = safeValidateDecision(decisionData);
      expect(safeResult.success).toBe(true);
    });
  });

  describe('ReasoningStage Best-of-N Candidate Selection Integration', () => {
    it('should promote highest utility candidate and emit risk_assessed event', async () => {
      const payTargetId = registry.register({
        role: 'button',
        name: 'Confirm Payment & Place Order',
        locatorStrategy: { type: 'role', selector: 'button' },
      });

      const mockPage = { url: () => 'https://store.local/checkout' } as unknown as Page;
      const mockPageObserver = {
        getRegistry: () => registry,
      } as unknown as PageObserver;

      const mockTabManager = {
        listTabs: () => [{ id: 'tab_01', url: 'https://store.local/checkout', title: 'Checkout' }],
      };
      const mockBranchManager = {
        getActiveBranches: () => [],
      };
      const mockBrowserManager = {
        getTabManager: () => mockTabManager,
        getTabBranchManager: () => mockBranchManager,
      } as unknown as BrowserManager;

      const mockPromptBuilder = {
        buildMessages: () => [{ role: 'user', content: 'test' }],
      } as unknown as PromptBuilder;

      const mockLlmProvider: LLMProvider = {
        generateDecision: async () => ({
          status: 'continue',
          reasoning_summary: 'Evaluating checkout choices',
          candidates: [
            {
              action: { type: 'click', targetId: payTargetId },
              reasoning: 'Pay directly',
              confidence: 0.95,
            },
            {
              action: { type: 'branch_tab', url: 'https://store.local/terms', branchGoal: 'Check coupon terms' },
              reasoning: 'Speculatively test coupon terms in branch',
              confidence: 0.90,
            },
          ],
          expectedOutcome: 'Terms checked',
        }),
      } as unknown as LLMProvider;

      const logger = new Logger('error');
      const eventLogger = new EventLogger(logger);
      const riskEvents: Array<Record<string, unknown>> = [];
      eventLogger.on('agent.risk_assessed', (data: { payload: Record<string, unknown> }) => {
        riskEvents.push(data.payload);
      });

      const reasoningStage = new ReasoningStage({
        browserManager: mockBrowserManager,
        pageObserver: mockPageObserver,
        promptBuilder: mockPromptBuilder,
        llmProvider: mockLlmProvider,
        planner: { formatPlanSummary: () => 'Plan' } as unknown as Planner,
        recoveryManager: { getPromptWarnings: () => [] } as unknown as RecoveryManager,
        memoryManager: new MemoryManager(),
        stateMachine: new AgentStateMachine(),
        logger,
        eventLogger,
        persistFindings: () => {},
        recordSuccessfulPlaybook: () => {},
        buildResult: () => ({} as unknown as AgentResult),
      });

      const context: LoopIterationContext = {
        task: { id: 'task_cand_01', goal: 'Test Best-of-N', maxSteps: 5 },
        stepCount: 1,
        currentSnapshot: {
          url: 'https://store.local/checkout',
          title: 'Checkout',
          activeTabId: 'tab_01',
          compressedObservationText: 'Button Confirm Payment [el_pay]',
        } as unknown as PageSnapshot,
        recentActions: [],
        plan: { goal: 'Test', milestones: [], currentMilestoneIndex: 0, lastUpdated: new Date().toISOString() },
        frustrationMonitor: new FrustrationMonitor(),
        activePage: mockPage,
        activeTabId: 'tab_01',
        maxSteps: 5,
        maxDurationMs: 60000,
        processedDownloadIds: new Set<string>(),
        startTime: Date.now(),
        sources: [],
      };

      const result = await reasoningStage.execute(context);
      expect(result.type).toBe('continue');
      expect(context.decision).toBeDefined();

      // branch_tab should have won over direct payment click!
      expect(context.decision?.action?.type).toBe('branch_tab');
      expect(context.decision?.reasoning_summary).toContain('Best-of-N Candidate #1');

      // Verify risk telemetry emitted
      expect(riskEvents.length).toBe(1);
      expect(riskEvents[0].actionType).toBe('branch_tab');
      expect(riskEvents[0].riskLevel).toBe('safe');
    });
  });
});

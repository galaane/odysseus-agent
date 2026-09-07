import type { BrowserManager } from '../../browser/BrowserManager.js';
import type { PromptBuilder, ActionHistoryEntry } from '../../llm/PromptBuilder.js';
import type { LLMProvider } from '../../llm/LLM.js';
import type { Planner } from '../Planner.js';
import type { RecoveryManager } from '../RecoveryManager.js';
import type { MemoryManager } from '../../memory/MemoryManager.js';
import type { AgentStateMachine } from '../AgentState.js';
import type { DomainPlaybookRepository } from '../../persistence/DomainPlaybookRepository.js';
import type { TaskRepository } from '../../persistence/TaskRepository.js';
import { PlaybookRanker } from '../../persistence/PlaybookRanker.js';
import type { EventLogger } from '../../logging/EventLogger.js';
import type { Logger } from '../../logging/Logger.js';
import type { Task, Source, AgentResult } from '../Agent.js';
import { ErrorCodes } from '../../browser/BrowserError.js';
import type { PageObserver } from '../../observer/PageObserver.js';
import { ActionRiskEvaluator, type RiskEvaluationContext } from '../ActionRiskEvaluator.js';
import type { IReasoningStage, LoopIterationContext, StageFlowResult } from './types.js';

export interface ReasoningStageOptions {
  browserManager: BrowserManager;
  pageObserver?: PageObserver;
  promptBuilder: PromptBuilder;
  llmProvider: LLMProvider;
  planner: Planner;
  recoveryManager: RecoveryManager;
  memoryManager: MemoryManager;
  stateMachine: AgentStateMachine;
  playbookRepo?: DomainPlaybookRepository;
  playbookRanker?: PlaybookRanker;
  taskRepo?: TaskRepository;
  eventLogger?: EventLogger;
  logger: Logger;
  persistFindings: (taskId: string, findings?: AgentResult['findings']) => void;
  recordSuccessfulPlaybook: (task: Task, sources: Source[], recentActions: ActionHistoryEntry[]) => void;
  recordSuccessfulMacro?: (task: Task, sources: Source[], executedActions: import('../../actions/Action.js').BrowserAction[]) => void;
  transferLearner?: import('../../graph/TransferLearner.js').TransferLearner;
  topologyRepo?: import('../../persistence/TopologyRepository.js').TopologyRepository;
  metaOptimizer?: import('../../optimization/MetaOptimizer.js').MetaOptimizer;
  hyperparameterRepo?: import('../../persistence/HyperparameterRepository.js').HyperparameterRepository;
  buildResult: (
    taskId: string,
    status: AgentResult['status'],
    summary: string,
    findings: AgentResult['findings'],
    sources: Source[],
    steps: number,
    startTime: number
  ) => AgentResult;
}

export class ReasoningStage implements IReasoningStage {
  private browserManager: BrowserManager;
  private pageObserver?: PageObserver;
  private promptBuilder: PromptBuilder;
  private llmProvider: LLMProvider;
  private planner: Planner;
  private recoveryManager: RecoveryManager;
  private memoryManager: MemoryManager;
  private stateMachine: AgentStateMachine;
  private playbookRepo?: DomainPlaybookRepository;
  private playbookRanker: PlaybookRanker;
  private riskEvaluator = new ActionRiskEvaluator();
  private taskRepo?: TaskRepository;
  private eventLogger?: EventLogger;
  private logger: Logger;
  private persistFindings: (taskId: string, findings?: AgentResult['findings']) => void;
  private recordSuccessfulPlaybook: (task: Task, sources: Source[], recentActions: ActionHistoryEntry[]) => void;
  private recordSuccessfulMacro?: (task: Task, sources: Source[], executedActions: import('../../actions/Action.js').BrowserAction[]) => void;
  private transferLearner?: import('../../graph/TransferLearner.js').TransferLearner;
  private topologyRepo?: import('../../persistence/TopologyRepository.js').TopologyRepository;
  private metaOptimizer?: import('../../optimization/MetaOptimizer.js').MetaOptimizer;
  private hyperparameterRepo?: import('../../persistence/HyperparameterRepository.js').HyperparameterRepository;
  private buildResult: (
    taskId: string,
    status: AgentResult['status'],
    summary: string,
    findings: AgentResult['findings'],
    sources: Source[],
    steps: number,
    startTime: number
  ) => AgentResult;

  constructor(options: ReasoningStageOptions) {
    this.browserManager = options.browserManager;
    this.pageObserver = options.pageObserver;
    this.promptBuilder = options.promptBuilder;
    this.llmProvider = options.llmProvider;
    this.planner = options.planner;
    this.recoveryManager = options.recoveryManager;
    this.memoryManager = options.memoryManager;
    this.stateMachine = options.stateMachine;
    this.playbookRepo = options.playbookRepo;
    this.playbookRanker = options.playbookRanker || new PlaybookRanker();
    this.taskRepo = options.taskRepo;
    this.eventLogger = options.eventLogger;
    this.logger = options.logger;
    this.persistFindings = options.persistFindings;
    this.recordSuccessfulPlaybook = options.recordSuccessfulPlaybook;
    this.recordSuccessfulMacro = options.recordSuccessfulMacro;
    this.transferLearner = options.transferLearner;
    this.topologyRepo = options.topologyRepo;
    this.metaOptimizer = options.metaOptimizer;
    this.hyperparameterRepo = options.hyperparameterRepo;
    this.buildResult = options.buildResult;
  }

  public getPlaybookRanker(): PlaybookRanker {
    return this.playbookRanker;
  }

  public getTransferLearner(): import('../../graph/TransferLearner.js').TransferLearner | undefined {
    return this.transferLearner;
  }

  public getTopologyRepo(): import('../../persistence/TopologyRepository.js').TopologyRepository | undefined {
    return this.topologyRepo;
  }

  public getMetaOptimizer(): import('../../optimization/MetaOptimizer.js').MetaOptimizer | undefined {
    return this.metaOptimizer;
  }

  public async execute(context: LoopIterationContext): Promise<StageFlowResult> {
    const {
      task,
      stepCount,
      startTime,
      currentSnapshot,
      screenshotBase64,
      sources,
      recentActions,
      plan,
      frustrationMonitor,
      controlSignal,
      activePage,
    } = context;

    if (!currentSnapshot || !activePage) {
      throw new Error('ReasoningStage requires currentSnapshot and activePage in context');
    }

    this.stateMachine.transitionTo('thinking');

    const tabManager = this.browserManager.getTabManager();
    const openTabs = tabManager.listTabs().map((t) => ({
      tabId: t.id,
      url: t.url,
      title: t.title,
    }));

    let currentDomain = '';
    if (currentSnapshot.url && currentSnapshot.url !== 'about:blank') {
      try {
        currentDomain = new URL(currentSnapshot.url).hostname;
      } catch {
        // Ignore URL parsing errors
      }
    }

    const domainPlaybooks = this.playbookRepo && currentDomain
      ? this.playbookRanker.rankAndFormat(
          this.playbookRepo.getPlaybooksByDomain(currentDomain),
          task.goal,
          {
            currentUrl: currentSnapshot.url,
            maxPlaybooks: 4,
            maxTokens: 450,
          }
        )
      : [];

    let transferRecommendationText = '';
    if (this.transferLearner && currentDomain && domainPlaybooks.length < 2) {
      try {
        const rec = this.transferLearner.getRecommendationsForPage(currentDomain, currentSnapshot);
        if (rec.promptSummary) {
          transferRecommendationText = rec.promptSummary;
        }
      } catch (err) {
        this.logger.debug('ReasoningStage', `TransferLearner recommendation error: ${String(err)}`);
      }
    }

    let topologyGuidanceText = '';
    if (this.topologyRepo && currentDomain) {
      try {
        const topology = this.topologyRepo.getTopology(currentDomain);
        if (topology.nodes.size > 0) {
          const knownPaths = Array.from(topology.nodes.keys()).slice(0, 6).join(', ');
          topologyGuidanceText = `[SITE TOPOLOGY]: Known mapped routes for ${currentDomain}: [${knownPaths}]. Discovered transitions: ${topology.edges.length}.`;
        }
      } catch (err) {
        this.logger.debug('ReasoningStage', `TopologyRepository query error: ${String(err)}`);
      }
    }

    let metaDirectives: string[] = [];
    if (this.metaOptimizer && currentDomain) {
      try {
        metaDirectives = this.metaOptimizer.getEffectiveDirectives(currentDomain);
      } catch (err) {
        this.logger.debug('ReasoningStage', `MetaOptimizer query error: ${String(err)}`);
      }
    }

    const branchManager = this.browserManager.getTabBranchManager();
    const activeBranches = branchManager.getActiveBranches().map((b) => ({
      branchId: b.branchId,
      tabId: b.tabId,
      branchGoal: b.branchGoal,
    }));

    const frustrationStatus = frustrationMonitor.getFrustrationLevel();
    const promptContext = {
      goal: task.goal,
      planSummary: this.planner.formatPlanSummary(plan),
      domainPlaybooks,
      currentObservationText: currentSnapshot.compressedObservationText,
      activeUrl: currentSnapshot.url,
      activeTabId: currentSnapshot.activeTabId,
      openTabs,
      activeBranches,
      recentActions,
      workingMemoryFacts: [
        this.planner.formatPlanSummary(plan),
        ...this.recoveryManager.getPromptWarnings(),
        ...this.memoryManager.formatMemoryForPrompt(),
        ...(transferRecommendationText ? [transferRecommendationText] : []),
        ...(topologyGuidanceText ? [topologyGuidanceText] : []),
        ...metaDirectives.map((d) => `[META-OPTIMIZED DIRECTIVE]: ${d}`),
        ...(context.lastStepCritique
          ? [context.lastStepCritique.summaryText]
          : []),
        ...(frustrationStatus.level !== 'low'
          ? [`[FRUSTRATION SYSTEM WARNING]: ${frustrationStatus.reason}. Do NOT repeat your previous actions.`]
          : []),
      ],
      customInstructions: task.customInstructions,
      screenshotBase64,
    };

    const messages = this.promptBuilder.buildMessages(promptContext);
    const decision = await this.llmProvider.generateDecision({ messages });

    this.logger.info('ReasoningStage', `LLM decision: ${decision.status}`, {
      status: decision.status,
      reasoning: decision.reasoning_summary,
      actionType: decision.action?.type,
    });

    if (this.eventLogger && decision.deliberation) {
      this.eventLogger.emit('agent.deliberation', {
        taskId: task.id,
        step: stepCount,
        deliberation: decision.deliberation,
        reasoning: decision.reasoning_summary,
        status: decision.status,
        action: decision.action?.type,
      });
    }

    // 1. Task Completed
    if (decision.status === 'complete') {
      this.recoveryManager.clear();
      this.stateMachine.transitionTo('completed');
      this.persistFindings(task.id, decision.finalFindings);
      this.recordSuccessfulPlaybook(task, sources, recentActions);
      if (this.recordSuccessfulMacro && context.executedBrowserActions) {
        this.recordSuccessfulMacro(task, sources, context.executedBrowserActions);
      }
      this.taskRepo?.updateTaskStatus(task.id, 'completed', { stepCount });

      return {
        type: 'terminal',
        result: this.buildResult(
          task.id,
          'completed',
          decision.reasoning_summary,
          decision.finalFindings || [],
          sources,
          stepCount,
          startTime
        ),
      };
    }

    // 2. Human Intervention Required
    if (decision.status === 'waiting_human_intervention') {
      this.logger.warn(
        'ReasoningStage',
        `External barrier detected: ${decision.reasoning_summary}. Entering waiting_human_intervention state...`,
        { goal: task.goal, activeUrl: currentSnapshot.url }
      );
      this.eventLogger?.emit('agent.intervention_required', {
        taskId: task.id,
        goal: task.goal,
        reasoning: decision.reasoning_summary,
        url: currentSnapshot.url,
      });
      this.stateMachine.transitionTo('waiting_human_intervention');

      const waitStart = Date.now();
      const maxWaitMs = 120000;
      const initialUrl = activePage.url();
      let resolved = false;

      while (Date.now() - waitStart < maxWaitMs) {
        if (controlSignal?.isStopped() || controlSignal?.isPaused()) {
          break;
        }
        if (controlSignal?.isInterventionResolved?.()) {
          this.logger.info('ReasoningStage', 'Manual human intervention confirmed resolved. Resuming task...');
          this.eventLogger?.emit('agent.intervention_resolved', { taskId: task.id });
          resolved = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
        try {
          const currentUrl = activePage.url();
          if (currentUrl !== initialUrl) {
            this.logger.info('ReasoningStage', 'URL change detected during human intervention wait. Resuming task...');
            this.eventLogger?.emit('agent.intervention_resolved', { taskId: task.id });
            resolved = true;
            break;
          }
        } catch {
          // Page may be navigating
        }
      }

      if (resolved) {
        this.stateMachine.transitionTo('observing');
        return { type: 'resume_iteration' };
      }

      this.logger.warn('ReasoningStage', 'Human intervention wait timed out. Transitioning to blocked.');
      this.stateMachine.transitionTo('failed');
      this.taskRepo?.updateTaskStatus(task.id, 'blocked', {
        stepCount,
        errorCode: ErrorCodes.VERIFICATION_REQUIRED,
        errorMessage: 'Human intervention wait timed out',
      });
      return {
        type: 'terminal',
        result: this.buildResult(
          task.id,
          'blocked',
          'Human intervention wait timed out',
          decision.finalFindings || [],
          sources,
          stepCount,
          startTime
        ),
      };
    }

    // 3. Agent Blocked
    if (decision.status === 'blocked') {
      this.recoveryManager.clear();
      this.stateMachine.transitionTo('failed');
      this.persistFindings(task.id, decision.finalFindings);
      this.taskRepo?.updateTaskStatus(task.id, 'blocked', {
        stepCount,
        errorCode: ErrorCodes.ELEMENT_NOT_INTERACTABLE,
        errorMessage: decision.reasoning_summary,
      });

      return {
        type: 'terminal',
        result: this.buildResult(
          task.id,
          'blocked',
          decision.reasoning_summary,
          decision.finalFindings || [],
          sources,
          stepCount,
          startTime
        ),
      };
    }

    // 4. Speculative Multi-Candidate Action Sampling & Risk Evaluation (Phase 31)
    const riskContext: RiskEvaluationContext = {
      elementRegistry: this.pageObserver?.getRegistry(),
      currentUrl: currentSnapshot.url,
      openTabsCount: openTabs.length,
      activeBranchesCount: activeBranches.length,
    };

    if (decision.candidates && decision.candidates.length > 0) {
      const ranked = this.riskEvaluator.evaluateCandidates(decision.candidates, riskContext);
      const best = ranked[0];

      if (best) {
        this.logger.info(
          'ReasoningStage',
          `Evaluated ${ranked.length} action candidates (Best-of-N). Selected candidate #${best.rank} (utility: ${best.utilityScore.toFixed(3)}, risk: ${best.assessment.riskLevel}, score: ${best.assessment.riskScore.toFixed(2)})`,
          {
            chosenActionType: best.candidate.action.type,
            chosenReasoning: best.candidate.reasoning,
            utilityScore: best.utilityScore,
          }
        );

        decision.action = best.candidate.action;
        decision.actions = [best.candidate.action];
        decision.reasoning_summary = `[Best-of-N Candidate #${best.rank} (Utility: ${best.utilityScore.toFixed(2)}, Risk: ${best.assessment.riskLevel})]: ${best.candidate.reasoning}`;
        if (best.candidate.expectedOutcome) {
          decision.expectedOutcome = best.candidate.expectedOutcome;
        }
      }
    }

    if (decision.action) {
      const assessment = this.riskEvaluator.assessActionRisk(decision.action, riskContext);
      if (this.eventLogger) {
        this.eventLogger.emit('agent.risk_assessed', {
          taskId: task.id,
          step: stepCount,
          actionType: decision.action.type,
          riskLevel: assessment.riskLevel,
          riskScore: assessment.riskScore,
          isIrreversible: assessment.isIrreversible,
          recommendedMitigation: assessment.recommendedMitigation,
        });
      }

      if (assessment.riskLevel === 'destructive') {
        this.logger.warn(
          'ReasoningStage',
          `Destructive action risk warning [${decision.action.type}]: ${assessment.reasons.join('; ')}. Mitigation: ${assessment.recommendedMitigation}`
        );
      }
    }

    // 5. Continue Execution
    context.decision = decision;
    return { type: 'continue' };
  }

  public getRiskEvaluator(): ActionRiskEvaluator {
    return this.riskEvaluator;
  }
}

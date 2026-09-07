import type { BrowserManager } from '../../browser/BrowserManager.js';
import type { ActionRegistry } from '../../actions/ActionRegistry.js';
import type { PageObserver } from '../../observer/PageObserver.js';
import type { RecoveryManager } from '../RecoveryManager.js';
import type { Planner } from '../Planner.js';
import type { MemoryManager } from '../../memory/MemoryManager.js';
import type { AgentStateMachine } from '../AgentState.js';
import type { LLMProvider } from '../../llm/LLM.js';
import type { Config } from '../../config/Config.js';
import type { TaskRepository } from '../../persistence/TaskRepository.js';
import type { ActionRepository } from '../../persistence/ActionRepository.js';
import type { ResearchRepository } from '../../persistence/ResearchRepository.js';
import type { Logger } from '../../logging/Logger.js';
import { ActionValidator } from '../../actions/ActionValidator.js';
import type { ActionExecutionContext } from '../../actions/ActionExecutionContext.js';
import { AgentError } from '../AgentError.js';
import { ErrorCodes } from '../../browser/BrowserError.js';
import { MemoryCompressor } from '../../memory/MemoryCompressor.js';
import type { IExecutionStage, LoopIterationContext, StageFlowResult } from './types.js';

export interface ExecutionStageOptions {
  browserManager: BrowserManager;
  actionRegistry: ActionRegistry;
  pageObserver: PageObserver;
  recoveryManager: RecoveryManager;
  planner: Planner;
  memoryManager: MemoryManager;
  stateMachine: AgentStateMachine;
  llmProvider: LLMProvider;
  config: Config;
  taskRepo?: TaskRepository;
  actionRepo?: ActionRepository;
  researchRepo?: ResearchRepository;
  saveCheckpoint: (taskId: string, stepIndex: number, currentUrl?: string | null, activeTabId?: string | null) => void;
  logger: Logger;
}

export class ExecutionStage implements IExecutionStage {
  private browserManager: BrowserManager;
  private actionRegistry: ActionRegistry;
  private pageObserver: PageObserver;
  private recoveryManager: RecoveryManager;
  private planner: Planner;
  private memoryManager: MemoryManager;
  private stateMachine: AgentStateMachine;
  private llmProvider: LLMProvider;
  private config: Config;
  private taskRepo?: TaskRepository;
  private actionRepo?: ActionRepository;
  private researchRepo?: ResearchRepository;
  private saveCheckpoint: (taskId: string, stepIndex: number, currentUrl?: string | null, activeTabId?: string | null) => void;
  private logger: Logger;
  private memoryCompressor: MemoryCompressor;

  constructor(options: ExecutionStageOptions) {
    this.browserManager = options.browserManager;
    this.actionRegistry = options.actionRegistry;
    this.pageObserver = options.pageObserver;
    this.recoveryManager = options.recoveryManager;
    this.planner = options.planner;
    this.memoryManager = options.memoryManager;
    this.stateMachine = options.stateMachine;
    this.llmProvider = options.llmProvider;
    this.config = options.config;
    this.taskRepo = options.taskRepo;
    this.actionRepo = options.actionRepo;
    this.researchRepo = options.researchRepo;
    this.saveCheckpoint = options.saveCheckpoint;
    this.logger = options.logger;
    this.memoryCompressor = new MemoryCompressor(this.llmProvider, this.logger);
  }

  public async execute(context: LoopIterationContext): Promise<StageFlowResult> {
    const { decision, activePage, activeTabId, task, currentSnapshot, recentActions, plan, frustrationMonitor } = context;

    if (!decision) {
      throw new AgentError(
        ErrorCodes.LLM_INVALID_OUTPUT,
        'ExecutionStage called without decision in context'
      );
    }

    if (!activePage || !activeTabId || !currentSnapshot) {
      throw new Error('ExecutionStage requires activePage, activeTabId, and currentSnapshot in context');
    }

    const actionsToExecute = decision.actions && decision.actions.length > 0
      ? decision.actions
      : decision.action ? [decision.action] : [];

    if (actionsToExecute.length === 0) {
      throw new AgentError(
        ErrorCodes.LLM_INVALID_OUTPUT,
        'LLM decision status was "continue" but no action was specified'
      );
    }

    this.stateMachine.transitionTo('acting');

    for (let i = 0; i < actionsToExecute.length; i++) {
      const action = actionsToExecute[i];
      context.stepCount++;

      // Validate action schema via Zod
      ActionValidator.validate(action);

      const executionContext: ActionExecutionContext = {
        page: activePage,
        tabId: activeTabId,
        browserManager: this.browserManager,
        logger: this.logger,
        elementResolver: this.pageObserver.getRegistry(),
        screenshotDir: this.config.screenshotDir,
        taskId: task.id,
        memoryManager: this.memoryManager,
        researchRepo: this.researchRepo,
        networkObserver: this.browserManager.getNetworkObserver(),
      };

      let actionResult = await this.actionRegistry.dispatch(action, executionContext);

      // Systematic Recovery Ladder (Phase 8): Trigger multi-tier recovery on action failure
      if (!actionResult.success && actionResult.error) {
        this.logger.warn('ExecutionStage', `Action failed, initiating recovery ladder: ${actionResult.error.message}`);
        const recovery = await this.recoveryManager.attemptRecovery(action, executionContext, actionResult.error);
        if (recovery.recovered && recovery.actionResult) {
          actionResult = recovery.actionResult;
          this.logger.info('ExecutionStage', `Action recovered via Tier ${recovery.tierUsed}: ${recovery.message}`);
        }
      }

      // Synchronize active page and active tab in context if tab navigation occurred
      if (
        actionResult.success &&
        ['switch_tab', 'new_tab', 'close_tab', 'branch_tab', 'prune_branch', 'promote_branch'].includes(action.type)
      ) {
        try {
          const currentActiveTab = this.browserManager.getTabManager().getActiveTab();
          if (currentActiveTab) {
            context.activeTabId = currentActiveTab.id;
            context.activePage = this.browserManager.getPageManager().getActivePage();
          }
        } catch {
          // Soft fail
        }
      }

      const actionTargetId = 'targetId' in action && typeof action.targetId === 'string'
        ? action.targetId
        : undefined;

      if (actionResult.success) {
        if (!context.executedBrowserActions) {
          context.executedBrowserActions = [];
        }
        context.executedBrowserActions.push(action);
        this.recoveryManager.recordActionOutcome(action, true);
        frustrationMonitor.recordSuccess();
      } else {
        frustrationMonitor.recordFailure(actionTargetId);

        if (frustrationMonitor.isCritical()) {
          const reason = frustrationMonitor.getFrustrationLevel().reason || 'Critical logic failure';
          this.logger.error('ExecutionStage', `Maximum frustration reached. Forcing strategy pivot. Reason: ${reason}`);
          
          // Inject into working memory facts and replan
          this.memoryManager.getWorkingMemory().addFact(`[CRITICAL PIVOT]: ${reason} ABANDON PREVIOUS APPROACH.`);
          this.planner.replan(plan, `Logical Deadlock Detected: ${reason}`, true);
          frustrationMonitor.recordSuccess(); // Reset after replan
          break; // Short-circuit burst execution, let planner handle the pivot
        }
      }

      // Persist executed action to SQLite and Memory
      this.memoryManager.getTaskMemory().recordAction({
        actionType: action.type,
        targetId: actionTargetId,
        success: actionResult.success,
        error: actionResult.error?.message,
      });

      if (this.actionRepo) {
        this.actionRepo.recordAction({
          id: `act_${task.id}_${context.stepCount}`,
          task_id: task.id,
          step_index: context.stepCount,
          action_type: action.type,
          parameters: JSON.stringify(action),
          success: actionResult.success ? 1 : 0,
          duration_ms: actionResult.durationMs || 0,
          error_code: actionResult.error?.code || null,
          error_message: actionResult.error?.message || null,
          created_at: new Date().toISOString(),
        });
      }

      if (this.taskRepo) {
        this.taskRepo.incrementStep(task.id);
      }

      // Save progress checkpoint
      this.saveCheckpoint(task.id, context.stepCount, currentSnapshot.url, currentSnapshot.activeTabId);

      recentActions.push({
        step: context.stepCount,
        actionType: action.type,
        targetId: actionTargetId,
        outcome: actionResult.success ? 'Success' : `Failed: ${actionResult.error?.message}`,
        summary: decision.reasoning_summary,
      });

      // Phase 20: Semantic Context Compression (Fading Memory)
      // Compress every 5 actions to keep context extremely clean and token usage optimal.
      if (recentActions.length >= 5) {
        // Run non-blocking so we don't stall the main loop
        const actionsToCompress = [...recentActions];

        // Keep only the very last action for immediate context continuity
        const lastAction = recentActions.pop();
        recentActions.length = 0;
        if (lastAction) recentActions.push(lastAction);

        // Fire and forget
        this.memoryCompressor
          .compressRecentActions(actionsToCompress)
          .then((summary) => {
            this.memoryManager
              .getWorkingMemory()
              .addFact(
                `[Semantic Log (Steps ${actionsToCompress[0].step}-${actionsToCompress[actionsToCompress.length - 1].step})]: ${summary}`
              );
          })
          .catch((err) => {
            this.logger.warn('ExecutionStage', `Failed background memory compression: ${String(err)}`);
          });
      }

      // Short-circuit if action failed
      if (!actionResult.success) {
        this.logger.warn('ExecutionStage', 'Action in chunk failed, short-circuiting remaining actions.');
        break;
      }
    }

    context.previousSnapshot = currentSnapshot;
    context.previousExpectedOutcome = decision.expectedOutcome ?? null;

    return { type: 'continue' };
  }
}

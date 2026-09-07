import type { BrowserManager } from '../browser/BrowserManager.js';
import { ActionMutex } from '../browser/ActionMutex.js';
import type { ActionRegistry } from '../actions/ActionRegistry.js';
import type { PageObserver } from '../observer/PageObserver.js';
import { ScreenshotObserver } from '../observer/ScreenshotObserver.js';
import type { LLMProvider } from '../llm/LLM.js';
import { PromptBuilder, type ActionHistoryEntry } from '../llm/PromptBuilder.js';
import { Evaluator } from './Evaluator.js';
import { Planner } from './Planner.js';
import { FrustrationMonitor } from './FrustrationMonitor.js';
import { AgentStateMachine } from './AgentState.js';
import { RecoveryManager } from './RecoveryManager.js';
import type { Logger } from '../logging/Logger.js';
import type { Config } from '../config/Config.js';
import { AgentError } from './AgentError.js';
import { ErrorCodes } from '../browser/BrowserError.js';
import type { Task, AgentResult, Source } from './Agent.js';
import type { SqliteDatabase } from '../persistence/Database.js';
import { TaskRepository } from '../persistence/TaskRepository.js';
import { CheckpointRepository } from '../persistence/CheckpointRepository.js';
import { ActionRepository } from '../persistence/ActionRepository.js';
import { ResearchRepository } from '../persistence/ResearchRepository.js';
import { DomainPlaybookRepository } from '../persistence/DomainPlaybookRepository.js';
import { MemoryManager } from '../memory/MemoryManager.js';
import { TrajectoryReflector } from '../memory/TrajectoryReflector.js';
import type { MemorySnapshot } from '../memory/types.js';
import { DocumentParser } from '../research/DocumentParser.js';
import type { EventLogger } from '../logging/EventLogger.js';
import { WorkflowMacroRepository } from '../persistence/WorkflowMacroRepository.js';
import { KnowledgeGraphRepository } from '../persistence/KnowledgeGraphRepository.js';
import { TopologyRepository } from '../persistence/TopologyRepository.js';
import { HyperparameterRepository } from '../persistence/HyperparameterRepository.js';
import { WatcherRepository } from '../persistence/WatcherRepository.js';
import { StateWatcherEngine } from '../watcher/StateWatcherEngine.js';
import type { WatcherJob, WatcherEvaluationResult } from '../watcher/types.js';
import { SelfHealingPipeline } from '../macros/SelfHealingPipeline.js';
import { MacroExecutor } from '../macros/MacroExecutor.js';
import { MacroSynthesizer } from '../macros/MacroSynthesizer.js';
import { KnowledgeGraph } from '../graph/KnowledgeGraph.js';
import { TransferLearner } from '../graph/TransferLearner.js';
import { SiteTopologyMapper } from '../exploration/SiteTopologyMapper.js';
import { CuriosityScorer } from '../exploration/CuriosityScorer.js';
import { CuriosityEngine } from '../exploration/CuriosityEngine.js';
import { MetaOptimizer } from '../optimization/MetaOptimizer.js';
import { BezierMouseEngine } from '../stealth/BezierMouseEngine.js';
import { KeystrokeJitterEngine } from '../stealth/KeystrokeJitterEngine.js';
import { ProfileHealthMonitor } from '../stealth/ProfileHealthMonitor.js';
import type { ExplorationBudget, ExplorationReport } from '../exploration/types.js';
import type { BrowserAction } from '../actions/Action.js';
import type { Page } from 'playwright-core';
import {
  type LoopIterationContext,
  PerceptionStage,
  EvaluationStage,
  ReasoningStage,
  ExecutionStage,
} from './pipeline/index.js';

export interface AgentLoopOptions {
  browserManager: BrowserManager;
  actionRegistry: ActionRegistry;
  pageObserver: PageObserver;
  screenshotObserver?: ScreenshotObserver;
  llmProvider: LLMProvider;
  promptBuilder?: PromptBuilder;
  evaluator?: Evaluator;
  planner?: Planner;
  recoveryManager?: RecoveryManager;
  stateMachine?: AgentStateMachine;
  memoryManager?: MemoryManager;
  database?: SqliteDatabase;
  documentParser?: DocumentParser;
  eventLogger?: EventLogger;
  logger: Logger;
  config: Config;
  macroRepo?: WorkflowMacroRepository;
  healingPipeline?: SelfHealingPipeline;
  macroExecutor?: MacroExecutor;
  macroSynthesizer?: MacroSynthesizer;
  kgRepo?: KnowledgeGraphRepository;
  knowledgeGraph?: KnowledgeGraph;
  transferLearner?: TransferLearner;
  topologyRepo?: TopologyRepository;
  topologyMapper?: SiteTopologyMapper;
  curiosityScorer?: CuriosityScorer;
  curiosityEngine?: CuriosityEngine;
  hyperparameterRepo?: HyperparameterRepository;
  metaOptimizer?: MetaOptimizer;
  watcherRepo?: WatcherRepository;
  watcherEngine?: StateWatcherEngine;
  bezierMouse?: BezierMouseEngine;
  keystrokeEngine?: KeystrokeJitterEngine;
  profileHealthMonitor?: ProfileHealthMonitor;
}

export interface LoopControlSignal {
  isPaused: () => boolean;
  isStopped: () => boolean;
  isInterventionResolved?: () => boolean;
}

export class AgentLoop {
  private browserManager: BrowserManager;
  private actionRegistry: ActionRegistry;
  private pageObserver: PageObserver;
  private screenshotObserver: ScreenshotObserver;
  private llmProvider: LLMProvider;
  private promptBuilder: PromptBuilder;
  private evaluator: Evaluator;
  private planner: Planner;
  private recoveryManager: RecoveryManager;
  private stateMachine: AgentStateMachine;
  private memoryManager: MemoryManager;
  private database?: SqliteDatabase;
  private taskRepo?: TaskRepository;
  private checkpointRepo?: CheckpointRepository;
  private actionRepo?: ActionRepository;
  private researchRepo?: ResearchRepository;
  private playbookRepo?: DomainPlaybookRepository;
  private macroRepo?: WorkflowMacroRepository;
  private healingPipeline?: SelfHealingPipeline;
  private macroExecutor?: MacroExecutor;
  private macroSynthesizer?: MacroSynthesizer;
  private kgRepo?: KnowledgeGraphRepository;
  private knowledgeGraph: KnowledgeGraph;
  private transferLearner: TransferLearner;
  private topologyRepo?: TopologyRepository;
  private topologyMapper?: SiteTopologyMapper;
  private curiosityScorer?: CuriosityScorer;
  private curiosityEngine?: CuriosityEngine;
  private hyperparameterRepo?: HyperparameterRepository;
  private metaOptimizer?: MetaOptimizer;
  private watcherRepo?: WatcherRepository;
  private watcherEngine?: StateWatcherEngine;
  private bezierMouse: BezierMouseEngine;
  private keystrokeEngine: KeystrokeJitterEngine;
  private profileHealthMonitor: ProfileHealthMonitor;
  private documentParser: DocumentParser;
  private eventLogger?: EventLogger;
  private logger: Logger;
  private config: Config;
  private trajectoryReflector: TrajectoryReflector;

  // Pipeline Stages
  private perceptionStage: PerceptionStage;
  private evaluationStage: EvaluationStage;
  private reasoningStage: ReasoningStage;
  private executionStage: ExecutionStage;

  constructor(options: AgentLoopOptions) {
    this.browserManager = options.browserManager;
    this.actionRegistry = options.actionRegistry;
    this.pageObserver = options.pageObserver;
    this.screenshotObserver =
      options.screenshotObserver || new ScreenshotObserver(options.config.screenshotDir);
    this.llmProvider = options.llmProvider;
    this.promptBuilder = options.promptBuilder || new PromptBuilder();
    this.evaluator = options.evaluator || new Evaluator();
    this.planner = options.planner || new Planner();
    this.recoveryManager =
      options.recoveryManager ||
      new RecoveryManager(this.browserManager, this.actionRegistry, this.pageObserver, options.logger);
    this.stateMachine = options.stateMachine || new AgentStateMachine('idle');
    this.memoryManager = options.memoryManager || new MemoryManager();
    this.documentParser = options.documentParser || new DocumentParser();
    this.eventLogger = options.eventLogger;
    this.database = options.database;
    if (this.database) {
      this.taskRepo = new TaskRepository(this.database);
      this.checkpointRepo = new CheckpointRepository(this.database);
      this.actionRepo = new ActionRepository(this.database);
      this.researchRepo = new ResearchRepository(this.database);
      this.playbookRepo = new DomainPlaybookRepository(this.database);
      this.macroRepo = options.macroRepo || new WorkflowMacroRepository(this.database);
      this.kgRepo = options.kgRepo || new KnowledgeGraphRepository(this.database);
      this.topologyRepo = options.topologyRepo || new TopologyRepository(this.database);
      this.hyperparameterRepo = options.hyperparameterRepo || new HyperparameterRepository(this.database);
      this.watcherRepo = options.watcherRepo || new WatcherRepository(this.database);
    } else if (options.macroRepo) {
      this.macroRepo = options.macroRepo;
    }
    if (options.kgRepo) {
      this.kgRepo = options.kgRepo;
    }
    if (options.topologyRepo) {
      this.topologyRepo = options.topologyRepo;
    }
    if (options.hyperparameterRepo) {
      this.hyperparameterRepo = options.hyperparameterRepo;
    }
    if (options.watcherRepo) {
      this.watcherRepo = options.watcherRepo;
    }
    this.logger = options.logger;
    this.config = options.config;

    this.knowledgeGraph =
      options.knowledgeGraph || new KnowledgeGraph(this.kgRepo, this.logger);

    this.transferLearner =
      options.transferLearner ||
      new TransferLearner({
        knowledgeGraph: this.knowledgeGraph,
        logger: this.logger,
      });

    if (this.topologyRepo) {
      this.topologyMapper =
        options.topologyMapper ||
        new SiteTopologyMapper(this.topologyRepo, this.knowledgeGraph, this.logger);
      this.curiosityScorer = options.curiosityScorer || new CuriosityScorer();
      this.curiosityEngine =
        options.curiosityEngine ||
        new CuriosityEngine({
          browserManager: this.browserManager,
          actionRegistry: this.actionRegistry,
          pageObserver: this.pageObserver,
          actionMutex:
            typeof this.browserManager.getMutex === 'function'
              ? this.browserManager.getMutex()
              : new ActionMutex(),
          topologyRepo: this.topologyRepo,
          topologyMapper: this.topologyMapper,
          scorer: this.curiosityScorer,
          macroSynthesizer: this.macroSynthesizer,
          logger: this.logger,
        });
    }

    this.healingPipeline =
      options.healingPipeline ||
      new SelfHealingPipeline(this.macroRepo, this.llmProvider, this.logger);

    this.macroExecutor =
      options.macroExecutor ||
      new MacroExecutor({
        browserManager: this.browserManager,
        actionRegistry: this.actionRegistry,
        pageObserver: this.pageObserver,
        macroRepo: this.macroRepo,
        healingPipeline: this.healingPipeline,
        logger: this.logger,
      });

    this.macroSynthesizer =
      options.macroSynthesizer ||
      new MacroSynthesizer(this.macroRepo, this.logger);

    if (this.hyperparameterRepo) {
      this.metaOptimizer =
        options.metaOptimizer ||
        new MetaOptimizer(this.hyperparameterRepo, this.logger);
    } else if (options.metaOptimizer) {
      this.metaOptimizer = options.metaOptimizer;
    }

    if (this.watcherRepo) {
      this.watcherEngine =
        options.watcherEngine ||
        new StateWatcherEngine({
          browserManager: this.browserManager,
          actionMutex:
            typeof this.browserManager.getMutex === 'function'
              ? this.browserManager.getMutex()
              : new ActionMutex(),
          watcherRepo: this.watcherRepo,
          macroExecutor: this.macroExecutor,
          macroRepo: this.macroRepo,
          eventLogger: this.eventLogger,
          logger: this.logger,
        });
    } else if (options.watcherEngine) {
      this.watcherEngine = options.watcherEngine;
    }

    this.bezierMouse = options.bezierMouse || new BezierMouseEngine(this.logger);
    this.keystrokeEngine = options.keystrokeEngine || new KeystrokeJitterEngine(this.logger);
    this.profileHealthMonitor =
      options.profileHealthMonitor ||
      new ProfileHealthMonitor(options.config.browserProfilePath, this.logger);

    this.trajectoryReflector = new TrajectoryReflector({
      llmProvider: this.llmProvider,
      playbookRepo: this.playbookRepo,
      actionRepo: this.actionRepo,
      logger: this.logger,
    });

    // Initialize decoupled pipeline stages
    this.perceptionStage = new PerceptionStage({
      browserManager: this.browserManager,
      pageObserver: this.pageObserver,
      screenshotObserver: this.screenshotObserver,
      memoryManager: this.memoryManager,
      researchRepo: this.researchRepo,
      logger: this.logger,
    });

    this.evaluationStage = new EvaluationStage({
      browserManager: this.browserManager,
      evaluator: this.evaluator,
      planner: this.planner,
      llmProvider: this.llmProvider,
      documentParser: this.documentParser,
      memoryManager: this.memoryManager,
      logger: this.logger,
    });

    this.reasoningStage = new ReasoningStage({
      browserManager: this.browserManager,
      pageObserver: this.pageObserver,
      promptBuilder: this.promptBuilder,
      llmProvider: this.llmProvider,
      planner: this.planner,
      recoveryManager: this.recoveryManager,
      memoryManager: this.memoryManager,
      stateMachine: this.stateMachine,
      playbookRepo: this.playbookRepo,
      taskRepo: this.taskRepo,
      eventLogger: this.eventLogger,
      logger: this.logger,
      persistFindings: (taskId, findings) => this.persistFindings(taskId, findings),
      recordSuccessfulPlaybook: (task, sources, recentActions) =>
        this.recordSuccessfulPlaybook(task, sources, recentActions),
      recordSuccessfulMacro: (task, sources, executedActions) =>
        this.recordSuccessfulMacro(task, sources, executedActions),
      transferLearner: this.transferLearner,
      topologyRepo: this.topologyRepo,
      metaOptimizer: this.metaOptimizer,
      hyperparameterRepo: this.hyperparameterRepo,
      buildResult: (taskId, status, summary, findings, sources, steps, startTime) =>
        this.buildResult(taskId, status, summary, findings, sources, steps, startTime),
    });

    this.executionStage = new ExecutionStage({
      browserManager: this.browserManager,
      actionRegistry: this.actionRegistry,
      pageObserver: this.pageObserver,
      recoveryManager: this.recoveryManager,
      planner: this.planner,
      memoryManager: this.memoryManager,
      stateMachine: this.stateMachine,
      llmProvider: this.llmProvider,
      config: this.config,
      taskRepo: this.taskRepo,
      actionRepo: this.actionRepo,
      researchRepo: this.researchRepo,
      saveCheckpoint: (taskId, stepIndex, currentUrl, activeTabId) =>
        this.saveCheckpoint(taskId, stepIndex, currentUrl, activeTabId),
      logger: this.logger,
    });
  }

  public getMemoryManager(): MemoryManager {
    return this.memoryManager;
  }

  public getDatabase(): SqliteDatabase | undefined {
    return this.database;
  }

  public getStateMachine(): AgentStateMachine {
    return this.stateMachine;
  }

  public getBrowserManager(): BrowserManager {
    return this.browserManager;
  }

  public getPerceptionStage(): PerceptionStage {
    return this.perceptionStage;
  }

  public getEvaluationStage(): EvaluationStage {
    return this.evaluationStage;
  }

  public getReasoningStage(): ReasoningStage {
    return this.reasoningStage;
  }

  public getExecutionStage(): ExecutionStage {
    return this.executionStage;
  }

  public getTrajectoryReflector(): TrajectoryReflector {
    return this.trajectoryReflector;
  }

  public getMacroRepo(): WorkflowMacroRepository | undefined {
    return this.macroRepo;
  }

  public getMacroExecutor(): MacroExecutor | undefined {
    return this.macroExecutor;
  }

  public getMacroSynthesizer(): MacroSynthesizer | undefined {
    return this.macroSynthesizer;
  }

  public getHealingPipeline(): SelfHealingPipeline | undefined {
    return this.healingPipeline;
  }

  public getKnowledgeGraph(): KnowledgeGraph {
    return this.knowledgeGraph;
  }

  public getTransferLearner(): TransferLearner {
    return this.transferLearner;
  }

  public getTopologyRepo(): TopologyRepository | undefined {
    return this.topologyRepo;
  }

  public getTopologyMapper(): SiteTopologyMapper | undefined {
    return this.topologyMapper;
  }

  public getCuriosityScorer(): CuriosityScorer | undefined {
    return this.curiosityScorer;
  }

  public getCuriosityEngine(): CuriosityEngine | undefined {
    return this.curiosityEngine;
  }

  public getHyperparameterRepo(): HyperparameterRepository | undefined {
    return this.hyperparameterRepo;
  }

  public getMetaOptimizer(): MetaOptimizer | undefined {
    return this.metaOptimizer;
  }

  public getWatcherRepo(): WatcherRepository | undefined {
    return this.watcherRepo;
  }

  public getWatcherEngine(): StateWatcherEngine | undefined {
    return this.watcherEngine;
  }

  public getBezierMouse(): BezierMouseEngine {
    return this.bezierMouse;
  }

  public getKeystrokeEngine(): KeystrokeJitterEngine {
    return this.keystrokeEngine;
  }

  public getProfileHealthMonitor(): ProfileHealthMonitor {
    return this.profileHealthMonitor;
  }

  public async exploreDomain(
    url: string,
    budget?: Partial<ExplorationBudget>
  ): Promise<ExplorationReport> {
    if (!this.curiosityEngine) {
      throw new Error('CuriosityEngine is not initialized (requires database or topologyRepo)');
    }
    return this.curiosityEngine.explore(url, budget);
  }

  /**
   * Executes the canonical reasoning and action loop for a given Task using the Stage Pipeline.
   */
  public async run(task: Task, controlSignal?: LoopControlSignal): Promise<AgentResult> {
    const startTime = Date.now();
    let stepCount = 0;
    const maxSteps = task.maxSteps || this.config.maxAgentSteps;
    const maxDurationMs = task.maxDurationMs || this.config.maxTaskDurationMs;

    const sources: Source[] = [];
    const recentActions: ActionHistoryEntry[] = [];
    const plan = await this.planner.decomposeGoalWithLLM(task.goal, this.llmProvider);
    const frustrationMonitor = new FrustrationMonitor();
    const processedDownloadIds = new Set<string>();

    const downloadManager = typeof this.browserManager.getDownloadManager === 'function'
      ? this.browserManager.getDownloadManager()
      : undefined;
    if (downloadManager) {
      downloadManager.setTaskId(task.id);
    }

    this.memoryManager.getTaskMemory().setGoal(task.goal);

    // Phase 32: Workflow Macro Fast-Path Check
    if (!task.checkpointId && this.macroRepo && this.macroExecutor && this.macroSynthesizer) {
      try {
        const fastPathResult = await this.attemptMacroFastPath(task, startTime);
        if (fastPathResult) {
          return fastPathResult;
        }
      } catch (err) {
        this.logger.warn(
          'AgentLoop',
          `Macro fast-path attempt failed: ${String(err)}. Falling back to deliberative loop.`
        );
      }
    }

    // Initialize or update task in database
    if (this.taskRepo) {
      const existing = this.taskRepo.getTask(task.id);
      if (!existing) {
        this.taskRepo.createTask({
          id: task.id,
          goal: task.goal,
          max_steps: maxSteps,
          status: 'running',
        });
      } else {
        this.taskRepo.updateTaskStatus(task.id, 'running');
      }
    }

    // Checkpoint restoration if resuming
    if (task.checkpointId && this.checkpointRepo) {
      const checkpoints = this.checkpointRepo.getCheckpoints(task.id);
      const checkpoint = checkpoints.find((c) => c.id === task.checkpointId) ||
        this.checkpointRepo.getLatestCheckpoint(task.id);
      if (checkpoint) {
        try {
          const snapshot: MemorySnapshot = JSON.parse(checkpoint.memory_snapshot);
          this.memoryManager.restoreFromSnapshot(snapshot);
          stepCount = checkpoint.step_index;
          this.logger.info('AgentLoop', `Resumed task ${task.id} from checkpoint ${checkpoint.id} at step ${stepCount}`);
        } catch (err) {
          this.logger.warn('AgentLoop', `Failed to parse checkpoint memory snapshot: ${String(err)}`);
        }
      }
    }

    this.logger.info('AgentLoop', `Starting task ${task.id}: "${task.goal}" (from step ${stepCount})`, {
      taskId: task.id,
      goal: task.goal,
      maxSteps,
      maxDurationMs,
      startingStep: stepCount,
    });

    this.stateMachine.transitionTo('starting');

    const context: LoopIterationContext = {
      task,
      stepCount,
      startTime,
      maxSteps,
      maxDurationMs,
      sources,
      recentActions,
      plan,
      frustrationMonitor,
      processedDownloadIds,
      controlSignal,
    };

    try {
      while (context.stepCount < maxSteps) {
        // 1. Check for cancellation / stop signal
        if (controlSignal?.isStopped()) {
          this.stateMachine.transitionTo('stopped');
          this.taskRepo?.updateTaskStatus(task.id, 'cancelled', { stepCount: context.stepCount });
          return this.buildResult(task.id, 'cancelled', 'Task was cancelled or stopped by user', [], sources, context.stepCount, startTime);
        }

        // 2. Check maximum duration
        const elapsedMs = Date.now() - startTime;
        if (elapsedMs > maxDurationMs) {
          this.stateMachine.transitionTo('failed');
          this.taskRepo?.updateTaskStatus(task.id, 'failed', {
            stepCount: context.stepCount,
            errorCode: ErrorCodes.PAGE_TIMEOUT,
            errorMessage: `Task duration exceeded limit of ${maxDurationMs}ms`,
          });
          return this.buildResult(task.id, 'timeout', `Task duration exceeded limit of ${maxDurationMs}ms`, [], sources, context.stepCount, startTime);
        }

        // 3. Check for pause signal
        if (controlSignal?.isPaused()) {
          this.stateMachine.transitionTo('paused');
          this.taskRepo?.updateTaskStatus(task.id, 'paused', { stepCount: context.stepCount });

          // Save checkpoint upon pausing
          this.saveCheckpoint(task.id, context.stepCount, context.previousSnapshot?.url, context.previousSnapshot?.activeTabId);

          while (controlSignal.isPaused() && !controlSignal.isStopped()) {
            await new Promise((res) => setTimeout(res, 200));
          }
          if (controlSignal.isStopped()) {
            this.stateMachine.transitionTo('stopped');
            this.taskRepo?.updateTaskStatus(task.id, 'cancelled', { stepCount: context.stepCount });
            return this.buildResult(task.id, 'cancelled', 'Task stopped while paused', [], sources, context.stepCount, startTime);
          }
          this.taskRepo?.updateTaskStatus(task.id, 'running');
        }

        // 4. Stage A: Perception
        this.stateMachine.transitionTo('observing');
        await this.perceptionStage.execute(context);

        // 5. Stage B: Evaluation & Document Ingestion
        if (context.previousSnapshot) {
          this.stateMachine.transitionTo('evaluating');
        }
        await this.evaluationStage.execute(context);

        // 6. Stage C: Reasoning & Decision
        const reasoningOutcome = await this.reasoningStage.execute(context);
        if (reasoningOutcome.type === 'terminal') {
          return reasoningOutcome.result;
        }
        if (reasoningOutcome.type === 'resume_iteration') {
          continue;
        }

        // 7. Stage D: Action Execution & Resilience
        const executionOutcome = await this.executionStage.execute(context);
        if (executionOutcome.type === 'terminal') {
          return executionOutcome.result;
        }
      }

      // Max steps exceeded
      this.recoveryManager.clear();
      this.stateMachine.transitionTo('failed');
      this.taskRepo?.updateTaskStatus(task.id, 'failed', {
        stepCount: context.stepCount,
        errorCode: ErrorCodes.PAGE_TIMEOUT,
        errorMessage: `Maximum step limit of ${maxSteps} reached without task completion`,
      });

      return this.buildResult(
        task.id,
        'timeout',
        `Maximum step limit of ${maxSteps} reached without task completion`,
        [],
        sources,
        context.stepCount,
        startTime
      );
    } catch (err: unknown) {
      this.recoveryManager.clear();
      this.stateMachine.transitionTo('failed');
      const message = err instanceof Error ? err.message : String(err);
      const code = err instanceof AgentError
        ? err.code
        : (typeof err === 'object' && err !== null && 'code' in err
          ? String((err as Record<string, unknown>).code)
          : ErrorCodes.UNKNOWN_ERROR);

      this.taskRepo?.updateTaskStatus(task.id, 'failed', {
        stepCount: context.stepCount,
        errorCode: code,
        errorMessage: message,
      });

      this.logger.error('AgentLoop', `Task execution failed: ${message}`, { error: message, code });

      return {
        taskId: task.id,
        status: 'failed',
        summary: `Execution aborted due to error: ${message}`,
        steps: context.stepCount,
        durationMs: Date.now() - startTime,
        sources,
        error: {
          code,
          message,
        },
      };
    } finally {
      if (downloadManager) {
        downloadManager.setTaskId(null);
      }
    }
  }

  private saveCheckpoint(taskId: string, stepIndex: number, currentUrl?: string | null, activeTabId?: string | null): void {
    if (!this.checkpointRepo) return;

    try {
      const snapshot = this.memoryManager.createSnapshot();
      this.checkpointRepo.saveCheckpoint({
        id: `chk_${taskId}_${stepIndex}`,
        task_id: taskId,
        step_index: stepIndex,
        agent_state: this.stateMachine.getState(),
        current_url: currentUrl || null,
        active_tab_id: activeTabId || null,
        memory_snapshot: JSON.stringify(snapshot),
        created_at: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.warn('AgentLoop', `Failed to save checkpoint: ${String(err)}`);
    }
  }

  private persistFindings(taskId: string, findings?: AgentResult['findings']): void {
    if (!findings || findings.length === 0) return;

    for (const f of findings) {
      this.memoryManager.getResearchMemory().addFinding({
        claim: f.claim,
        sourceUrls: f.sourceUrls,
        confidence: f.confidence,
        notes: f.notes,
      });

      if (this.researchRepo) {
        this.researchRepo.saveFinding({
          id: `find_${taskId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          task_id: taskId,
          claim: f.claim,
          source_ids: JSON.stringify(f.sourceUrls),
          confidence: f.confidence ?? 1.0,
          notes: f.notes || null,
          created_at: new Date().toISOString(),
        });
      }
    }
  }

  private buildResult(
    taskId: string,
    status: AgentResult['status'],
    summary: string,
    findings: AgentResult['findings'],
    sources: Source[],
    steps: number,
    startTime: number
  ): AgentResult {
    const result: AgentResult = {
      taskId,
      status,
      summary,
      findings: findings && findings.length > 0 ? findings : undefined,
      sources: sources.length > 0 ? sources : undefined,
      steps,
      durationMs: Date.now() - startTime,
    };

    // Phase 26: Post-task Metacognitive Reflexion (asynchronous fire-and-forget)
    this.trajectoryReflector
      .reflectOnTask({
        taskId,
        goal: this.memoryManager.getTaskMemory().getGoal() || summary,
        status,
        summary,
        sources,
        steps,
      })
      .catch((err) => {
        this.logger.warn('AgentLoop', `Background task reflection encountered error: ${String(err)}`);
      });

    // Phase 36: Empirical Hyperparameter & Prompt Meta-Optimization
    if (this.metaOptimizer) {
      let domain = '';
      if (sources && sources.length > 0) {
        for (const s of sources) {
          try {
            const parsed = new URL(s.url).hostname;
            if (parsed) {
              domain = parsed;
              break;
            }
          } catch {
            // ignore
          }
        }
      }
      if (!domain) {
        try {
          const activePage = this.browserManager.getPageManager().getActivePage();
          const currentUrl = activePage?.url();
          if (currentUrl && currentUrl.startsWith('http')) {
            domain = new URL(currentUrl).hostname;
          }
        } catch {
          // ignore
        }
      }
      if (domain) {
        try {
          this.metaOptimizer.recordTaskOutcome({
            taskId,
            domain,
            steps,
            durationMs: result.durationMs,
            success: status === 'completed',
            failureReason: status !== 'completed' ? summary : undefined,
          });
        } catch (err) {
          this.logger.warn('AgentLoop', `Failed to record task outcome in MetaOptimizer: ${String(err)}`);
        }
      }
    }

    return result;
  }

  private recordSuccessfulPlaybook(task: Task, sources: Source[], recentActions: ActionHistoryEntry[]): void {
    if (!this.playbookRepo || recentActions.length === 0) return;

    for (const source of sources) {
      try {
        const domain = new URL(source.url).hostname;
        if (!domain) continue;

        const actionSummary = recentActions
          .slice(-5)
          .map((a) => `${a.actionType}${a.targetId ? `->${a.targetId}` : ''}`)
          .join('; ');

        this.playbookRepo.savePlaybook({
          id: `pb_${domain.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`,
          domain,
          pattern_type: 'workflow',
          pattern_key: task.goal.slice(0, 50),
          playbook_data: JSON.stringify({
            goal: task.goal,
            entryUrl: source.url,
            actionSequence: actionSummary,
          }),
          last_applied_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        });
      } catch {
        // Ignore domain parsing errors
      }
    }
  }

  private async attemptMacroFastPath(task: Task, startTime: number): Promise<AgentResult | null> {
    if (!this.macroRepo || !this.macroExecutor || !this.macroSynthesizer) {
      return null;
    }

    const { intentKey, parameters } = this.macroSynthesizer.extractIntent(task.goal);
    if (!intentKey) {
      return null;
    }

    let activePage: Page | undefined;
    try {
      activePage = this.browserManager.getPageManager().getActivePage();
    } catch {
      // no active page yet
    }

    let targetDomain: string | undefined;
    if (activePage) {
      const url = activePage.url();
      if (url && url !== 'about:blank' && url.startsWith('http')) {
        try {
          targetDomain = new URL(url).hostname;
        } catch {
          // ignore
        }
      }
    }

    if (!targetDomain) {
      const urlMatch = task.goal.match(/https?:\/\/([^/\s:]+)/i);
      if (urlMatch && urlMatch[1]) {
        targetDomain = urlMatch[1];
      }
    }

    if (!targetDomain) {
      return null;
    }

    const macro = this.macroRepo.getMacroByDomainAndIntent(targetDomain, intentKey);
    if (!macro || (macro.status !== 'verified' && macro.status !== 'provisional')) {
      return null;
    }

    this.logger.info(
      'AgentLoop',
      `Found ${macro.status} workflow macro [${macro.id}] for domain ${targetDomain} (intent: ${intentKey}). Attempting fast-path execution...`
    );

    if (!activePage) {
      const browserCtx = this.browserManager.getContext();
      if (browserCtx) {
        activePage = await browserCtx.newPage();
      }
    }

    if (!activePage) {
      return null;
    }

    const activeTab = this.browserManager.getTabManager().getActiveTab();
    const tabId = activeTab ? activeTab.id : 'tab_001';

    const macroResult = await this.macroExecutor.executeMacro(macro, parameters, {
      page: activePage,
      tabId,
      taskId: task.id,
    });

    if (macroResult.success) {
      this.logger.info(
        'AgentLoop',
        `Macro fast-path succeeded for [${macro.id}]: executed ${macroResult.executedSteps} steps (${macroResult.healedCount} healed).`
      );
      this.stateMachine.transitionTo('completed');
      this.taskRepo?.updateTaskStatus(task.id, 'completed', { stepCount: macroResult.executedSteps });

      const finalUrl = activePage.url();
      const pageTitle = await activePage.title().catch(() => '');
      const sources: Source[] = finalUrl && finalUrl !== 'about:blank' ? [{ url: finalUrl, title: pageTitle }] : [];

      return this.buildResult(
        task.id,
        'completed',
        `Task completed deterministically via fast-path macro [${macro.id}] in ${macroResult.executedSteps} steps (${macroResult.healedCount} healed).`,
        [],
        sources,
        macroResult.executedSteps,
        startTime
      );
    } else {
      this.logger.warn(
        'AgentLoop',
        `Fast-path macro [${macro.id}] failed at step ${macroResult.failedStepIndex ?? 'unknown'}: ${macroResult.error?.message}. Falling back to deliberative loop.`
      );
      return null;
    }
  }

  private recordSuccessfulMacro(
    task: Task,
    sources: Source[],
    executedActions: BrowserAction[]
  ): void {
    if (!this.macroSynthesizer || !executedActions || executedActions.length < 2) return;

    let domain: string | undefined;
    if (sources && sources.length > 0) {
      for (const s of sources) {
        try {
          const parsed = new URL(s.url).hostname;
          if (parsed) {
            domain = parsed;
            break;
          }
        } catch {
          // ignore
        }
      }
    }

    if (!domain) {
      try {
        const activePage = this.browserManager.getPageManager().getActivePage();
        const currentUrl = activePage?.url();
        if (currentUrl && currentUrl.startsWith('http')) {
          domain = new URL(currentUrl).hostname;
        }
      } catch {
        // ignore
      }
    }

    if (!domain) return;

    try {
      this.macroSynthesizer.synthesizeFromTrajectory(task, domain, executedActions, {
        elementRegistry: this.pageObserver.getRegistry(),
      });
    } catch (err) {
      this.logger.warn('AgentLoop', `Failed to synthesize macro from trajectory: ${String(err)}`);
    }
  }
}

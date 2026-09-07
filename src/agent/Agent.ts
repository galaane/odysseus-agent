import type { Finding } from '../llm/schemas.js';
import type { AgentState } from './AgentState.js';
import { AgentLoop, type AgentLoopOptions } from './AgentLoop.js';
import { AgentError } from './AgentError.js';
import { ErrorCodes } from '../browser/BrowserError.js';

export interface Source {
  url: string;
  title?: string;
  accessedAt?: string;
}

export interface Task {
  id: string;
  goal: string;
  createdAt?: string;
  maxSteps?: number;
  maxDurationMs?: number;
  customInstructions?: string;
  checkpointId?: string;
}

export interface AgentResult {
  taskId: string;
  status: 'completed' | 'failed' | 'blocked' | 'cancelled' | 'timeout';
  summary: string;
  findings?: Finding[];
  sources?: Source[];
  steps: number;
  durationMs: number;
  error?: {
    code: string;
    message: string;
  };
}

export interface Agent {
  run(task: Task): Promise<AgentResult>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  resolveIntervention?(taskId?: string): boolean;
  resumeFromCheckpoint?(
    taskId: string,
    checkpointId?: string,
    options?: { maxSteps?: number; maxDurationMs?: number }
  ): Promise<AgentResult>;
}

export class OdysseusAgent implements Agent {
  private loop: AgentLoop;
  private isPausedState = false;
  private isStoppedState = false;
  private isInterventionResolvedState = false;
  private isRunning = false;

  constructor(options: AgentLoopOptions) {
    this.loop = new AgentLoop(options);
  }

  /**
   * Executes a task using the autonomous reasoning and action loop.
   * Rejects concurrent execution if a task is already in flight (Invariant 1).
   */
  public async run(task: Task): Promise<AgentResult> {
    if (this.isRunning) {
      throw new AgentError(
        ErrorCodes.BROWSER_ALREADY_RUNNING,
        'Another task is currently running. Exactly one active task is allowed at a time.'
      );
    }

    this.isRunning = true;
    this.isPausedState = false;
    this.isStoppedState = false;
    this.isInterventionResolvedState = false;

    try {
      const result = await this.loop.run(task, {
        isPaused: () => this.isPausedState,
        isStopped: () => this.isStoppedState,
        isInterventionResolved: () => {
          if (this.isInterventionResolvedState) {
            this.isInterventionResolvedState = false;
            return true;
          }
          return false;
        },
      });
      return result;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Resolves an ongoing human intervention and signals the loop to resume.
   */
  public resolveIntervention(taskId?: string): boolean {
    if (!this.isRunning || this.getState() !== 'waiting_human_intervention') {
      return false;
    }
    this.isInterventionResolvedState = true;
    return true;
  }

  /**
   * Pauses the active loop before the next action/observation step.
   */
  public async pause(): Promise<void> {
    if (!this.isRunning) return;
    this.isPausedState = true;
    this.loop.getStateMachine().transitionTo('paused');
  }

  /**
   * Resumes execution if the agent is currently paused.
   */
  public async resume(): Promise<void> {
    if (!this.isRunning) return;
    this.isPausedState = false;
  }

  /**
   * Stops/cancels the currently executing task.
   */
  public async stop(): Promise<void> {
    this.isStoppedState = true;
    this.isPausedState = false;
    this.loop.getStateMachine().transitionTo('stopped');
  }

  /**
   * Returns current lifecycle state of the agent.
   */
  public getState(): AgentState {
    return this.loop.getStateMachine().getState();
  }

  /**
   * Direct access to internal loop (e.g. for testing and diagnostics).
   */
  public getLoop(): AgentLoop {
    return this.loop;
  }

  public getMemoryManager(): import('../memory/MemoryManager.js').MemoryManager {
    return this.loop.getMemoryManager();
  }

  public getDatabase(): import('../persistence/Database.js').SqliteDatabase | undefined {
    return this.loop.getDatabase();
  }

  public getBrowserManager(): import('../browser/BrowserManager.js').BrowserManager {
    return this.loop.getBrowserManager();
  }

  public getMacroRepo(): import('../persistence/WorkflowMacroRepository.js').WorkflowMacroRepository | undefined {
    return this.loop.getMacroRepo();
  }

  public getMacroExecutor(): import('../macros/MacroExecutor.js').MacroExecutor | undefined {
    return this.loop.getMacroExecutor();
  }

  public getKnowledgeGraph(): import('../graph/KnowledgeGraph.js').KnowledgeGraph {
    return this.loop.getKnowledgeGraph();
  }

  public getTopologyRepo(): import('../persistence/TopologyRepository.js').TopologyRepository | undefined {
    return this.loop.getTopologyRepo();
  }

  public getHyperparameterRepo(): import('../persistence/HyperparameterRepository.js').HyperparameterRepository | undefined {
    return this.loop.getHyperparameterRepo();
  }

  public getWatcherRepo(): import('../persistence/WatcherRepository.js').WatcherRepository | undefined {
    return this.loop.getWatcherRepo();
  }

  public getWatcherEngine(): import('../watcher/StateWatcherEngine.js').StateWatcherEngine | undefined {
    return this.loop.getWatcherEngine();
  }

  public getProfileHealthMonitor(): import('../stealth/ProfileHealthMonitor.js').ProfileHealthMonitor {
    return this.loop.getProfileHealthMonitor();
  }

  public async resumeFromCheckpoint(
    taskId: string,
    checkpointId?: string,
    options?: { maxSteps?: number; maxDurationMs?: number }
  ): Promise<AgentResult> {
    const db = this.getDatabase();
    if (!db) {
      throw new AgentError(ErrorCodes.UNKNOWN_ERROR, 'Cannot resume without an active database');
    }
    const { TaskRepository } = await import('../persistence/TaskRepository.js');
    const taskRepo = new TaskRepository(db);
    const taskRecord = taskRepo.getTask(taskId);
    if (!taskRecord) {
      throw new AgentError(ErrorCodes.ELEMENT_NOT_FOUND, `Task ${taskId} not found in database`);
    }

    const maxSteps = options?.maxSteps ?? taskRecord.max_steps;

    const task: Task = {
      id: taskRecord.id,
      goal: taskRecord.goal,
      maxSteps,
      maxDurationMs: options?.maxDurationMs ?? undefined,
      checkpointId: checkpointId || undefined,
    };

    return this.run(task);
  }
}

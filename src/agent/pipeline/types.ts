import type { Page } from 'playwright-core';
import type { Task, Source, AgentResult } from '../Agent.js';
import type { PageSnapshot } from '../../observer/PageSnapshot.js';
import type { ActionHistoryEntry } from '../../llm/PromptBuilder.js';
import type { Plan } from '../Planner.js';
import type { FrustrationMonitor } from '../FrustrationMonitor.js';
import type { LLMDecision } from '../../llm/schemas.js';
import type { LoopControlSignal } from '../AgentLoop.js';
import type { StepCritique } from '../MicroReflector.js';

/**
 * Shared runtime context across all pipeline stages in a single loop cycle.
 */
export interface LoopIterationContext {
  task: Task;
  stepCount: number;
  startTime: number;
  maxSteps: number;
  maxDurationMs: number;
  sources: Source[];
  recentActions: ActionHistoryEntry[];
  plan: Plan;
  frustrationMonitor: FrustrationMonitor;
  processedDownloadIds: Set<string>;
  controlSignal?: LoopControlSignal;

  // Ephemeral per-iteration state
  activePage?: Page;
  activeTabId?: string;
  currentSnapshot?: PageSnapshot;
  screenshotBase64?: string;
  previousSnapshot?: PageSnapshot | null;
  previousExpectedOutcome?: string | null;
  decision?: LLMDecision;
  lastStepCritique?: StepCritique | null;
  executedBrowserActions?: import('../../actions/Action.js').BrowserAction[];
}

/**
 * Result returned by a stage indicating how the outer loop should proceed.
 */
export type StageFlowResult =
  | { type: 'continue' }
  | { type: 'terminal'; result: AgentResult }
  | { type: 'resume_iteration' };

/**
 * Pipeline stage contracts.
 */
export interface IPerceptionStage {
  execute(context: LoopIterationContext): Promise<void>;
}

export interface IEvaluationStage {
  execute(context: LoopIterationContext): Promise<void>;
}

export interface IReasoningStage {
  execute(context: LoopIterationContext): Promise<StageFlowResult>;
}

export interface IExecutionStage {
  execute(context: LoopIterationContext): Promise<StageFlowResult>;
}

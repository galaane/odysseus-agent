import type { BrowserAction } from '../actions/Action.js';

export interface ParameterizedMacroStep {
  stepNumber: number;
  actionTemplate: BrowserAction | Record<string, unknown>;
  primaryTargetRole?: string;
  primaryTargetName?: string;
  primaryTargetId?: string;
  fallbackSelectors?: string[];
  expectedOutcome?: string;
}

export type MacroStatus = 'provisional' | 'verified' | 'degraded' | 'deprecated';

export interface WorkflowMacro {
  id: string;
  domain: string;
  intentKey: string;
  parameterKeys: string[];
  steps: ParameterizedMacroStep[];
  status: MacroStatus;
  successCount: number;
  failureCount: number;
  healingCount: number;
  lastHealedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MacroExecutionResult {
  success: boolean;
  macroId: string;
  executedSteps: number;
  healedCount: number;
  failedStepIndex?: number;
  error?: Error;
  durationMs: number;
}

export interface MacroHealingResult {
  healed: boolean;
  repairedTargetId?: string;
  tierUsed: 'heuristic' | 'llm' | 'none';
  updatedStep?: ParameterizedMacroStep;
  reason?: string;
}

export interface IntentExtractionResult {
  intentKey: string;
  parameters: Record<string, string>;
  isParametric: boolean;
}

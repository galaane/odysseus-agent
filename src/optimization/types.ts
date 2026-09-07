export interface DomainHyperparameters {
  id: string;
  domainOrArchetype: string; // e.g., 'store.local', 'ecommerce', or 'global'
  riskAversionFactor: number; // 0.1 to 0.9 (default: 0.5)
  maxRetries: number; // 1 to 5 (default: 2)
  tokenBudget: number; // 1500 to 4500 (default: 3000)
  frustrationThreshold: number; // 2 to 6 (default: 3)
  promptDirectives: string[]; // concise behavioral directives for LLM prompt
  sampleCount: number;
  successCount: number;
  updatedAt: string;
}

export interface TaskExecutionMetric {
  taskId: string;
  domain: string;
  archetype?: string;
  steps: number;
  durationMs: number;
  success: boolean;
  failureReason?: string;
  healingUsed?: boolean;
  recoveryUsed?: boolean;
}

export interface OptimizationProposal {
  domainOrArchetype: string;
  previousParams: DomainHyperparameters;
  updatedParams: DomainHyperparameters;
  reasoning: string;
}

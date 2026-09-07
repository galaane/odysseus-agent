import type { AgentResult } from '../agent/Agent.js';

export type ChaosFaultType =
  | 'network_latency'
  | 'network_500'
  | 'cookie_banner_injection'
  | 'promo_modal_injection'
  | 'dom_mutation'
  | 'stale_element'
  | 'session_warning';

export interface ChaosProfile {
  level: 'mild' | 'moderate' | 'extreme';
  activeFaults: ChaosFaultType[];
  faultProbability: number; // 0.0 to 1.0 probability per action step
  networkLatencyMs?: { min: number; max: number };
  mutationIntensity?: number; // 1 (mild attribute shifts) to 5 (heavy node re-wrapping)
}

export interface ChaosScenario {
  id: string;
  name: string;
  description: string;
  targetUrl: string;
  taskGoal: string;
  profile: ChaosProfile;
  expectedSuccessAssertion?: (result: AgentResult) => boolean;
}

export interface GauntletTrialResult {
  trialId: string;
  scenarioId: string;
  scenarioName: string;
  chaosLevel: 'mild' | 'moderate' | 'extreme';
  success: boolean;
  stepsExecuted: number;
  durationMs: number;
  faultsInjected: ChaosFaultType[];
  interventionsTriggered: string[];
  unhandledErrors: string[];
  resilienceScore: number; // 0.0 to 1.0
}

export interface FaultMetric {
  injected: number;
  recovered: number;
}

export interface ResilienceSummary {
  totalTrials: number;
  passedTrials: number;
  overallPassRate: number; // 0.0 to 1.0
  averageResilienceScore: number;
  averageSteps: number;
  averageDurationMs: number;
  faultBreakdown: Record<ChaosFaultType, FaultMetric>;
  synthesizedAntiPatterns: string[];
}

export interface ResilienceReport {
  timestamp: string;
  summary: ResilienceSummary;
  trials: GauntletTrialResult[];
  markdownReport: string;
}

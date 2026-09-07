export type WatcherConditionType =
  | 'price_below'
  | 'price_above'
  | 'text_contains'
  | 'element_present'
  | 'element_missing'
  | 'regex_match';

export type WatcherTriggerType = 'notify_hitl' | 'execute_macro' | 'execute_task';

export type WatcherJobStatus = 'active' | 'paused' | 'triggered' | 'expired';

export interface WatcherJob {
  id: string;
  name: string;
  targetUrl: string;
  conditionType: WatcherConditionType;
  conditionTarget: string; // CSS selector or XPath or empty for whole page
  conditionValue: string | number; // Threshold number or string/regex pattern
  triggerType: WatcherTriggerType;
  triggerPayload?: Record<string, unknown>;
  intervalMs: number; // Polling cadence in ms (e.g., 60_000)
  adaptiveJitter: boolean; // Add +/- 20% random variance to avoid detection
  status: WatcherJobStatus;
  lastCheckedAt?: number;
  expiresAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface WatcherEvaluationResult {
  jobId: string;
  conditionMet: boolean;
  currentObservedValue: unknown;
  dispatched: boolean;
  timestamp: number;
  error?: string;
}

export type WatcherTriggerHandler = (
  job: WatcherJob,
  evaluation: WatcherEvaluationResult
) => Promise<void> | void;

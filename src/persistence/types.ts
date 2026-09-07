export type TaskStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'cancelled';

export interface TaskRecord {
  id: string;
  goal: string;
  status: TaskStatus;
  max_steps: number;
  step_count: number;
  created_at: string;
  finished_at: string | null;
  error_code: string | null;
  error_message: string | null;
}

export interface TaskCheckpointRecord {
  id: string;
  task_id: string;
  step_index: number;
  agent_state: string;
  current_url: string | null;
  active_tab_id: string | null;
  memory_snapshot: string;
  created_at: string;
}

export interface PersistedActionRecord {
  id: string;
  task_id: string;
  step_index: number;
  action_type: string;
  parameters: string;
  success: number;
  duration_ms: number;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
}

export interface PersistedSourceRecord {
  id: string;
  task_id: string;
  url: string;
  title: string | null;
  domain: string;
  accessed_at: string;
  relevance: number | null;
}

export interface PersistedFindingRecord {
  id: string;
  task_id: string;
  claim: string;
  source_ids: string;
  confidence: number | null;
  notes: string | null;
  created_at: string;
}

export interface DomainPlaybookRecord {
  id: string;
  domain: string;
  pattern_type: string;
  pattern_key: string;
  playbook_data: string;
  success_count: number;
  last_applied_at: string;
  created_at: string;
}

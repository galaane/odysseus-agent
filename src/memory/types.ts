export interface WorkingFact {
  id: string;
  text: string;
  domain?: string;
  category?: string;
  createdAt: string;
}

export interface TaskMilestone {
  id: string;
  title: string;
  completed: boolean;
}

export interface UnresolvedQuestion {
  id: string;
  question: string;
  askedAt: string;
  resolved?: boolean;
  answer?: string;
}

export interface AttemptedActionSummary {
  actionType: string;
  targetId?: string;
  success: boolean;
  error?: string;
}

export interface ResearchSourceItem {
  id: string;
  url: string;
  domain: string;
  title?: string;
  accessedAt: string;
  relevance?: number;
}

export interface ResearchClaimItem {
  id: string;
  claim: string;
  sourceUrls: string[];
  confidence?: number;
  notes?: string;
  createdAt: string;
}

export interface MemorySnapshot {
  workingFacts: WorkingFact[];
  taskGoal: string;
  visitedUrls: string[];
  unresolvedQuestions: UnresolvedQuestion[];
  milestones: TaskMilestone[];
  attemptedActions: AttemptedActionSummary[];
  sources: ResearchSourceItem[];
  findings: ResearchClaimItem[];
  timestamp: string;
}

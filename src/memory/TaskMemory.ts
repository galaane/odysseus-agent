import type { AttemptedActionSummary, TaskMilestone, UnresolvedQuestion } from './types.js';

export class TaskMemory {
  private goal = '';
  private visitedUrls: Set<string> = new Set();
  private milestones: TaskMilestone[] = [];
  private questions: Map<string, UnresolvedQuestion> = new Map();
  private attemptedActions: AttemptedActionSummary[] = [];
  private questionCounter = 0;

  constructor(initialGoal = '') {
    this.goal = initialGoal;
  }

  public setGoal(goal: string): void {
    this.goal = goal;
  }

  public getGoal(): string {
    return this.goal;
  }

  public addVisitedUrl(url: string): void {
    if (url && url !== 'about:blank') {
      this.visitedUrls.add(url);
    }
  }

  public getVisitedUrls(): string[] {
    return Array.from(this.visitedUrls);
  }

  public hasVisitedUrl(url: string): boolean {
    return this.visitedUrls.has(url);
  }

  public recordAction(action: AttemptedActionSummary): void {
    this.attemptedActions.push(action);
  }

  public getAttemptedActions(): AttemptedActionSummary[] {
    return [...this.attemptedActions];
  }

  public setMilestones(milestones: TaskMilestone[]): void {
    this.milestones = milestones.map((m) => ({ ...m }));
  }

  public getMilestones(): TaskMilestone[] {
    return this.milestones.map((m) => ({ ...m }));
  }

  public updateMilestone(id: string, completed: boolean): void {
    const milestone = this.milestones.find((m) => m.id === id);
    if (milestone) {
      milestone.completed = completed;
    }
  }

  public addQuestion(question: string): string {
    this.questionCounter++;
    const id = `q_${String(this.questionCounter).padStart(3, '0')}`;
    this.questions.set(id, {
      id,
      question: question.trim(),
      askedAt: new Date().toISOString(),
      resolved: false,
    });
    return id;
  }

  public resolveQuestion(id: string, answer: string): void {
    const q = this.questions.get(id);
    if (q) {
      q.resolved = true;
      q.answer = answer.trim();
    }
  }

  public getUnresolvedQuestions(): UnresolvedQuestion[] {
    return Array.from(this.questions.values()).filter((q) => !q.resolved);
  }

  public getAllQuestions(): UnresolvedQuestion[] {
    return Array.from(this.questions.values());
  }

  public serialize(): {
    goal: string;
    visitedUrls: string[];
    milestones: TaskMilestone[];
    unresolvedQuestions: UnresolvedQuestion[];
    attemptedActions: AttemptedActionSummary[];
  } {
    return {
      goal: this.goal,
      visitedUrls: Array.from(this.visitedUrls),
      milestones: this.milestones.map((m) => ({ ...m })),
      unresolvedQuestions: Array.from(this.questions.values()),
      attemptedActions: [...this.attemptedActions],
    };
  }

  public deserialize(data: {
    goal: string;
    visitedUrls: string[];
    milestones?: TaskMilestone[];
    unresolvedQuestions?: UnresolvedQuestion[];
    attemptedActions?: AttemptedActionSummary[];
  }): void {
    this.goal = data.goal || '';
    this.visitedUrls = new Set(data.visitedUrls || []);
    this.milestones = data.milestones ? data.milestones.map((m) => ({ ...m })) : [];
    this.attemptedActions = data.attemptedActions ? [...data.attemptedActions] : [];
    this.questions.clear();

    if (data.unresolvedQuestions) {
      for (const q of data.unresolvedQuestions) {
        this.questions.set(q.id, { ...q });
        const num = parseInt(q.id.replace('q_', ''), 10);
        if (!isNaN(num) && num > this.questionCounter) {
          this.questionCounter = num;
        }
      }
    }
  }
}

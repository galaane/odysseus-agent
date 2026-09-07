import { WorkingMemory } from './WorkingMemory.js';
import { TaskMemory } from './TaskMemory.js';
import { ResearchMemory } from './ResearchMemory.js';
import type { MemorySnapshot } from './types.js';

export class MemoryManager {
  private readonly workingMemory: WorkingMemory;
  private readonly taskMemory: TaskMemory;
  private readonly researchMemory: ResearchMemory;

  constructor(taskGoal = '') {
    this.workingMemory = new WorkingMemory();
    this.taskMemory = new TaskMemory(taskGoal);
    this.researchMemory = new ResearchMemory();
  }

  public getWorkingMemory(): WorkingMemory {
    return this.workingMemory;
  }

  public getTaskMemory(): TaskMemory {
    return this.taskMemory;
  }

  public getResearchMemory(): ResearchMemory {
    return this.researchMemory;
  }

  /**
   * Sanitizes text to enforce Invariant 11 (Isolated Credentials):
   * Ensures passwords, tokens, and authorization secrets NEVER enter agent memory.
   */
  public sanitize(text: string): string {
    return text
      .replace(/(password|passwd|secret|apikey|api_key|access_token|bearer)\s*[:=]\s*[^\s,]+/gi, '$1=[REDACTED]')
      .replace(/Bearer\s+[A-Za-z0-9\-_.]+/g, 'Bearer [REDACTED]');
  }

  /**
   * Creates a complete serializable MemorySnapshot for checkpointing.
   */
  public createSnapshot(): MemorySnapshot {
    const taskData = this.taskMemory.serialize();
    const researchData = this.researchMemory.serialize();

    return {
      workingFacts: this.workingMemory.serialize(),
      taskGoal: taskData.goal,
      visitedUrls: taskData.visitedUrls,
      unresolvedQuestions: taskData.unresolvedQuestions,
      milestones: taskData.milestones,
      attemptedActions: taskData.attemptedActions,
      sources: researchData.sources,
      findings: researchData.findings,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Restores all 3 memory tiers from a saved MemorySnapshot.
   */
  public restoreFromSnapshot(snapshot: MemorySnapshot): void {
    this.workingMemory.deserialize(snapshot.workingFacts || []);
    this.taskMemory.deserialize({
      goal: snapshot.taskGoal || '',
      visitedUrls: snapshot.visitedUrls || [],
      milestones: snapshot.milestones || [],
      unresolvedQuestions: snapshot.unresolvedQuestions || [],
      attemptedActions: snapshot.attemptedActions || [],
    });
    this.researchMemory.deserialize({
      sources: snapshot.sources || [],
      findings: snapshot.findings || [],
    });
  }

  /**
   * Generates formatted memory facts to inject into the LLM system prompt.
   */
  public formatMemoryForPrompt(): string[] {
    const lines: string[] = [];

    // 1. Visited URLs summary
    const visited = this.taskMemory.getVisitedUrls();
    if (visited.length > 0) {
      lines.push(`[Visited Pages (${visited.length})]: ${visited.slice(-5).join(', ')}`);
    }

    // 2. Unresolved questions
    const openQuestions = this.taskMemory.getUnresolvedQuestions();
    if (openQuestions.length > 0) {
      lines.push(`[Open Questions]: ${openQuestions.map((q) => q.question).join('; ')}`);
    }

    // 3. Transient working facts
    const facts = this.workingMemory.getFacts();
    for (const fact of facts) {
      lines.push(`[Working Fact]: ${this.sanitize(fact)}`);
    }

    // 4. Research findings collected
    const findings = this.researchMemory.getFindings();
    if (findings.length > 0) {
      lines.push(`[Established Findings (${findings.length})]:`);
      for (const f of findings.slice(-5)) {
        lines.push(` - ${f.claim} (Confidence: ${f.confidence ?? 1.0})`);
      }
    }

    return lines;
  }
}

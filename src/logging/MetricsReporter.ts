import type { Logger } from './Logger.js';

export interface QualityMetrics {
  tasks: {
    total: number;
    successful: number;
    failed: number;
    successRate: number;
    averageSteps: number;
    averageDurationMs: number;
  };
  actions: {
    total: number;
    successful: number;
    failed: number;
    successRate: number;
    byType: Record<string, { total: number; successful: number; failed: number }>;
  };
  recovery: {
    totalAttempts: number;
    successfulRecoveries: number;
    failedRecoveries: number;
    recoveryRate: number;
    byTier: Record<number, number>;
  };
  tokens: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  timestamp: string;
}

export class MetricsReporter {
  private totalTasks = 0;
  private successfulTasks = 0;
  private failedTasks = 0;
  private totalSteps = 0;
  private totalTaskDurationMs = 0;

  private totalActions = 0;
  private successfulActions = 0;
  private failedActions = 0;
  private actionsByType = new Map<string, { total: number; successful: number; failed: number }>();

  private recoveryAttempts = 0;
  private successfulRecoveries = 0;
  private failedRecoveries = 0;
  private recoveriesByTier = new Map<number, number>();

  private promptTokens = 0;
  private completionTokens = 0;
  private totalTokens = 0;

  constructor(private readonly logger?: Logger) {}

  /**
   * Records completed task execution metrics.
   */
  public recordTask(result: { success: boolean; steps: number; durationMs?: number }): void {
    this.totalTasks++;
    if (result.success) {
      this.successfulTasks++;
    } else {
      this.failedTasks++;
    }
    this.totalSteps += result.steps;
    if (result.durationMs) {
      this.totalTaskDurationMs += result.durationMs;
    }
    this.logger?.debug('MetricsReporter', `Recorded task #${this.totalTasks}: success=${result.success}, steps=${result.steps}`);
  }

  /**
   * Records individual action execution results.
   */
  public recordAction(actionType: string, success: boolean, _durationMs?: number): void {
    this.totalActions++;
    if (success) {
      this.successfulActions++;
    } else {
      this.failedActions++;
    }

    const typeStats = this.actionsByType.get(actionType) || { total: 0, successful: 0, failed: 0 };
    typeStats.total++;
    if (success) {
      typeStats.successful++;
    } else {
      typeStats.failed++;
    }
    this.actionsByType.set(actionType, typeStats);
  }

  /**
   * Records recovery ladder attempt outcomes.
   */
  public recordRecovery(recovered: boolean, tierUsed?: number): void {
    this.recoveryAttempts++;
    if (recovered) {
      this.successfulRecoveries++;
      if (tierUsed !== undefined) {
        this.recoveriesByTier.set(tierUsed, (this.recoveriesByTier.get(tierUsed) || 0) + 1);
      }
    } else {
      this.failedRecoveries++;
    }
  }

  /**
   * Records LLM token consumption.
   */
  public recordTokens(tokens: { promptTokens: number; completionTokens: number; totalTokens?: number }): void {
    this.promptTokens += tokens.promptTokens;
    this.completionTokens += tokens.completionTokens;
    this.totalTokens += tokens.totalTokens ?? tokens.promptTokens + tokens.completionTokens;
  }

  /**
   * Computes quality metrics summary snapshot.
   */
  public getMetrics(): QualityMetrics {
    const taskSuccessRate = this.totalTasks > 0 ? this.successfulTasks / this.totalTasks : 1.0;
    const averageSteps = this.totalTasks > 0 ? this.totalSteps / this.totalTasks : 0;
    const averageDurationMs = this.totalTasks > 0 ? this.totalTaskDurationMs / this.totalTasks : 0;

    const actionSuccessRate = this.totalActions > 0 ? this.successfulActions / this.totalActions : 1.0;

    const recoveryRate = this.recoveryAttempts > 0 ? this.successfulRecoveries / this.recoveryAttempts : 1.0;

    const byTypeObj: Record<string, { total: number; successful: number; failed: number }> = {};
    for (const [type, stats] of this.actionsByType.entries()) {
      byTypeObj[type] = { ...stats };
    }

    const byTierObj: Record<number, number> = {};
    for (const [tier, count] of this.recoveriesByTier.entries()) {
      byTierObj[tier] = count;
    }

    return {
      tasks: {
        total: this.totalTasks,
        successful: this.successfulTasks,
        failed: this.failedTasks,
        successRate: taskSuccessRate,
        averageSteps,
        averageDurationMs,
      },
      actions: {
        total: this.totalActions,
        successful: this.successfulActions,
        failed: this.failedActions,
        successRate: actionSuccessRate,
        byType: byTypeObj,
      },
      recovery: {
        totalAttempts: this.recoveryAttempts,
        successfulRecoveries: this.successfulRecoveries,
        failedRecoveries: this.failedRecoveries,
        recoveryRate,
        byTier: byTierObj,
      },
      tokens: {
        promptTokens: this.promptTokens,
        completionTokens: this.completionTokens,
        totalTokens: this.totalTokens,
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Emits a formatted Markdown report of current quality metrics.
   */
  public generateSummary(): string {
    const m = this.getMetrics();
    return [
      '# Odysseus Autonomous Agent — Quality & Performance Metrics',
      `Generated at: ${m.timestamp}`,
      '',
      '## 1. Task Execution Metrics',
      `- Total Tasks: ${m.tasks.total}`,
      `- Successful Tasks: ${m.tasks.successful}`,
      `- Failed Tasks: ${m.tasks.failed}`,
      `- Task Success Rate: ${(m.tasks.successRate * 100).toFixed(1)}%`,
      `- Average Steps per Task: ${m.tasks.averageSteps.toFixed(1)}`,
      `- Average Duration: ${(m.tasks.averageDurationMs / 1000).toFixed(2)}s`,
      '',
      '## 2. Action Engine Metrics',
      `- Total Browser Actions: ${m.actions.total}`,
      `- Successful Actions: ${m.actions.successful}`,
      `- Failed Actions: ${m.actions.failed}`,
      `- Action Success Rate: ${(m.actions.successRate * 100).toFixed(1)}%`,
      '',
      '## 3. Systematic Recovery Metrics',
      `- Total Recovery Attempts: ${m.recovery.totalAttempts}`,
      `- Successful Recoveries: ${m.recovery.successfulRecoveries}`,
      `- Recovery Success Rate: ${(m.recovery.recoveryRate * 100).toFixed(1)}%`,
      '',
      '## 4. LLM Token Consumption',
      `- Prompt Tokens: ${m.tokens.promptTokens.toLocaleString()}`,
      `- Completion Tokens: ${m.tokens.completionTokens.toLocaleString()}`,
      `- Total Tokens: ${m.tokens.totalTokens.toLocaleString()}`,
    ].join('\n');
  }

  public reset(): void {
    this.totalTasks = 0;
    this.successfulTasks = 0;
    this.failedTasks = 0;
    this.totalSteps = 0;
    this.totalTaskDurationMs = 0;

    this.totalActions = 0;
    this.successfulActions = 0;
    this.failedActions = 0;
    this.actionsByType.clear();

    this.recoveryAttempts = 0;
    this.successfulRecoveries = 0;
    this.failedRecoveries = 0;
    this.recoveriesByTier.clear();

    this.promptTokens = 0;
    this.completionTokens = 0;
    this.totalTokens = 0;
  }
}

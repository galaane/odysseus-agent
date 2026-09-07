export class FrustrationMonitor {
  private targetFailures: Map<string, number> = new Map();
  private consecutiveGeneralFailures = 0;
  private readonly MAX_TARGET_FRUSTRATION = 3;
  private readonly MAX_GENERAL_FRUSTRATION = 5;

  /**
   * Records a failure for a specific action target or a general failure.
   */
  public recordFailure(targetId?: string): void {
    this.consecutiveGeneralFailures++;
    
    if (targetId) {
      const current = this.targetFailures.get(targetId) || 0;
      this.targetFailures.set(targetId, current + 1);
    }
  }

  /**
   * Resets all frustration metrics on a successful state transition.
   */
  public recordSuccess(): void {
    this.consecutiveGeneralFailures = 0;
    this.targetFailures.clear();
  }

  /**
   * Analyzes the current failure metrics and returns the frustration level.
   */
  public getFrustrationLevel(): { level: 'low' | 'medium' | 'high' | 'critical', reason?: string } {
    let maxTargetFrustration = 0;
    let worstTarget = '';

    for (const [targetId, failures] of this.targetFailures.entries()) {
      if (failures > maxTargetFrustration) {
        maxTargetFrustration = failures;
        worstTarget = targetId;
      }
    }

    if (maxTargetFrustration >= this.MAX_TARGET_FRUSTRATION) {
      return { level: 'critical', reason: `Failed to interact with target ${worstTarget} ${maxTargetFrustration} times.` };
    }

    if (this.consecutiveGeneralFailures >= this.MAX_GENERAL_FRUSTRATION) {
      return { level: 'critical', reason: `Failed to make progress for ${this.consecutiveGeneralFailures} consecutive steps.` };
    }

    if (maxTargetFrustration > 1 || this.consecutiveGeneralFailures > 2) {
      return { level: 'high' };
    }

    if (maxTargetFrustration === 1 || this.consecutiveGeneralFailures > 0) {
      return { level: 'medium' };
    }

    return { level: 'low' };
  }

  /**
   * True if frustration threshold has been breached and strategy pivot is required.
   */
  public isCritical(): boolean {
    return this.getFrustrationLevel().level === 'critical';
  }
}

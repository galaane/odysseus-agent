import type { HyperparameterRepository } from '../persistence/HyperparameterRepository.js';
import type { DomainHyperparameters, TaskExecutionMetric, OptimizationProposal } from './types.js';
import type { Logger } from '../logging/Logger.js';

export class MetaOptimizer {
  constructor(
    private readonly repo: HyperparameterRepository,
    private readonly logger?: Logger
  ) {}

  /**
   * Evaluates task execution telemetry, updates empirical metrics, and adapts
   * operational hyperparameters and prompt directives per domain/archetype.
   */
  public recordTaskOutcome(metric: TaskExecutionMetric): OptimizationProposal | null {
    const targetKey = metric.domain.toLowerCase().trim();
    if (!targetKey) return null;

    const currentParams = this.repo.getParams(targetKey) || {
      ...this.repo.getEffectiveParams(targetKey, metric.archetype),
      id: `param_${targetKey.replace(/[^a-z0-9]/gi, '_')}`,
      domainOrArchetype: targetKey,
      sampleCount: 0,
      successCount: 0,
    };

    const previousParams: DomainHyperparameters = {
      ...currentParams,
      promptDirectives: [...currentParams.promptDirectives],
    };

    const updatedParams: DomainHyperparameters = {
      ...currentParams,
      sampleCount: currentParams.sampleCount + 1,
      successCount: currentParams.successCount + (metric.success ? 1 : 0),
      promptDirectives: [...currentParams.promptDirectives],
      updatedAt: new Date().toISOString(),
    };

    let tuned = false;
    const reasons: string[] = [];

    if (!metric.success) {
      const reason = (metric.failureReason || '').toLowerCase();

      // Case 1: Timeout / Excessive steps -> Reduce risk aversion, increase token budget
      if (reason.includes('timeout') || metric.steps >= 8) {
        const oldRisk = updatedParams.riskAversionFactor;
        updatedParams.riskAversionFactor = Math.max(0.2, Number((oldRisk - 0.05).toFixed(2)));

        const oldBudget = updatedParams.tokenBudget;
        updatedParams.tokenBudget = Math.min(4200, oldBudget + 300);

        updatedParams.frustrationThreshold = Math.min(5, updatedParams.frustrationThreshold + 1);

        reasons.push(
          `Task timeout/long trajectory observed: lowered risk aversion (${oldRisk} -> ${updatedParams.riskAversionFactor}), expanded token budget (${oldBudget} -> ${updatedParams.tokenBudget})`
        );
        tuned = true;
      }

      // Case 2: Validation errors or loop failure -> Increase retries and inject targeted prompt directive
      if (reason.includes('validation') || reason.includes('selector') || reason.includes('loop') || reason.includes('obstruction')) {
        const oldRetries = updatedParams.maxRetries;
        updatedParams.maxRetries = Math.min(5, oldRetries + 1);

        const oldRisk = updatedParams.riskAversionFactor;
        updatedParams.riskAversionFactor = Math.max(0.2, Number((oldRisk - 0.04).toFixed(2)));

        const directive = 'prefer-semantic-locators-and-wait-for-dom-settle';
        if (!updatedParams.promptDirectives.includes(directive)) {
          updatedParams.promptDirectives.push(directive);
        }

        reasons.push(
          `Validation/selector error detected: increased max retries (${oldRetries} -> ${updatedParams.maxRetries}), adjusted risk aversion (${oldRisk} -> ${updatedParams.riskAversionFactor}), added prompt directive`
        );
        tuned = true;
      }

      // Case 3: Anti-bot / CAPTCHA / Cloudflare challenges -> Inject anti-fingerprinting directive
      if (reason.includes('bot') || reason.includes('captcha') || reason.includes('cloudflare') || reason.includes('challenge')) {
        const directive = 'maximize-action-jitter-and-strict-anti-fingerprinting';
        if (!updatedParams.promptDirectives.includes(directive)) {
          updatedParams.promptDirectives.push(directive);
        }
        reasons.push('Anti-bot challenge detected: enabled action jitter and anti-fingerprinting directive');
        tuned = true;
      }
    } else {
      // Case 4: High-efficiency success -> Safely optimize token budget and reward confidence
      if (metric.steps <= 3) {
        const oldRisk = updatedParams.riskAversionFactor;
        updatedParams.riskAversionFactor = Math.min(0.9, Number((oldRisk + 0.02).toFixed(2)));

        const oldBudget = updatedParams.tokenBudget;
        if (oldBudget > 1500) {
          updatedParams.tokenBudget = Math.max(1500, oldBudget - 150);
          reasons.push(`High-efficiency success: optimized token budget (${oldBudget} -> ${updatedParams.tokenBudget}) and increased confidence (${oldRisk} -> ${updatedParams.riskAversionFactor})`);
          tuned = true;
        }
      }
    }

    this.repo.saveParams(updatedParams);

    // If an archetype is associated and we have confidence (sampleCount >= 2), sync archetype defaults
    if (metric.archetype && updatedParams.sampleCount >= 2) {
      const archKey = metric.archetype.toLowerCase().trim();
      const existingArch = this.repo.getParams(archKey);
      if (!existingArch || existingArch.sampleCount < updatedParams.sampleCount) {
        this.repo.saveParams({
          ...updatedParams,
          id: `param_arch_${archKey}`,
          domainOrArchetype: archKey,
          updatedAt: new Date().toISOString(),
        });
      }
    }

    if (!tuned) {
      return null;
    }

    const proposal: OptimizationProposal = {
      domainOrArchetype: targetKey,
      previousParams,
      updatedParams,
      reasoning: reasons.join('; '),
    };

    this.logger?.info(
      'MetaOptimizer',
      `Auto-tuned hyperparameters for [${targetKey}]: ${proposal.reasoning}`
    );

    return proposal;
  }

  /**
   * Synchronizes an archetype profile by aggregating and averaging the empirical parameters
   * of constituent domains.
   */
  public synchronizeArchetypeParams(archetype: string, domainKeys: string[]): DomainHyperparameters {
    const archKey = archetype.toLowerCase().trim();
    const domainParams = domainKeys
      .map((k) => this.repo.getParams(k.toLowerCase().trim()))
      .filter((p): p is DomainHyperparameters => p !== null);

    if (domainParams.length === 0) {
      return this.repo.getEffectiveParams(undefined, archKey);
    }

    const avgRisk = Number(
      (domainParams.reduce((acc, p) => acc + p.riskAversionFactor, 0) / domainParams.length).toFixed(2)
    );
    const avgRetries = Math.round(
      domainParams.reduce((acc, p) => acc + p.maxRetries, 0) / domainParams.length
    );
    const avgBudget = Math.round(
      domainParams.reduce((acc, p) => acc + p.tokenBudget, 0) / domainParams.length
    );
    const avgFrustration = Math.round(
      domainParams.reduce((acc, p) => acc + p.frustrationThreshold, 0) / domainParams.length
    );

    const mergedDirectives = Array.from(
      new Set(domainParams.flatMap((p) => p.promptDirectives))
    );

    const totalSamples = domainParams.reduce((acc, p) => acc + p.sampleCount, 0);
    const totalSuccess = domainParams.reduce((acc, p) => acc + p.successCount, 0);

    const archetypeParams: DomainHyperparameters = {
      id: `param_arch_${archKey}`,
      domainOrArchetype: archKey,
      riskAversionFactor: avgRisk,
      maxRetries: avgRetries,
      tokenBudget: avgBudget,
      frustrationThreshold: avgFrustration,
      promptDirectives: mergedDirectives,
      sampleCount: totalSamples,
      successCount: totalSuccess,
      updatedAt: new Date().toISOString(),
    };

    this.repo.saveParams(archetypeParams);

    this.logger?.info(
      'MetaOptimizer',
      `Synchronized archetype [${archKey}] parameters across ${domainParams.length} domains.`
    );

    return archetypeParams;
  }

  public getEffectiveDirectives(domain?: string, archetype?: string): string[] {
    const params = this.repo.getEffectiveParams(domain, archetype);
    return params.promptDirectives;
  }
}

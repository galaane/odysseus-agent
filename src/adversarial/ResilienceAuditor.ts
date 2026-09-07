import type {
  GauntletTrialResult,
  ResilienceSummary,
  ResilienceReport,
  ChaosFaultType,
  FaultMetric,
} from './types.js';
import type { DomainPlaybookRepository } from '../persistence/DomainPlaybookRepository.js';
import type { Logger } from '../logging/Logger.js';

export class ResilienceAuditor {
  constructor(
    private readonly playbookRepo?: DomainPlaybookRepository,
    private readonly logger?: Logger
  ) {}

  public computeTrialScore(trial: {
    success: boolean;
    unhandledErrors: string[];
    interventionsTriggered: string[];
  }): number {
    if (!trial.success) {
      return 0.0;
    }

    const unhandledPenalty = Math.min(0.4, trial.unhandledErrors.length * 0.1);
    return Math.max(0.5, 1.0 - unhandledPenalty);
  }

  public auditTrials(trials: GauntletTrialResult[], domain = 'test-site.local'): ResilienceSummary {
    const totalTrials = trials.length;
    const passedTrials = trials.filter((t) => t.success).length;
    const overallPassRate = totalTrials > 0 ? passedTrials / totalTrials : 0;

    const totalResilienceScore = trials.reduce((sum, t) => sum + t.resilienceScore, 0);
    const averageResilienceScore = totalTrials > 0 ? totalResilienceScore / totalTrials : 0;

    const totalSteps = trials.reduce((sum, t) => sum + t.stepsExecuted, 0);
    const averageSteps = totalTrials > 0 ? totalSteps / totalTrials : 0;

    const totalDuration = trials.reduce((sum, t) => sum + t.durationMs, 0);
    const averageDurationMs = totalTrials > 0 ? totalDuration / totalTrials : 0;

    // Fault breakdown tracking
    const faultBreakdown: Record<ChaosFaultType, FaultMetric> = {
      network_latency: { injected: 0, recovered: 0 },
      network_500: { injected: 0, recovered: 0 },
      cookie_banner_injection: { injected: 0, recovered: 0 },
      promo_modal_injection: { injected: 0, recovered: 0 },
      dom_mutation: { injected: 0, recovered: 0 },
      stale_element: { injected: 0, recovered: 0 },
      session_warning: { injected: 0, recovered: 0 },
    };

    for (const trial of trials) {
      for (const fault of trial.faultsInjected) {
        faultBreakdown[fault].injected++;
        if (trial.success) {
          faultBreakdown[fault].recovered++;
        }
      }
    }

    // Synthesize anti-patterns from observed chaos recovery
    const synthesizedAntiPatterns: string[] = [];

    if (faultBreakdown.cookie_banner_injection.injected > 0 || faultBreakdown.promo_modal_injection.injected > 0) {
      synthesizedAntiPatterns.push(
        "When blocking dialog or modal overlay appears, dismiss immediately using button with aria-label 'Close' or 'Accept All' before attempting background target interactions."
      );
    }

    if (faultBreakdown.dom_mutation.injected > 0) {
      synthesizedAntiPatterns.push(
        'Prefer resilient ARIA role and accessible name matching over static CSS class or numeric ID selectors during dynamic DOM mutations.'
      );
    }

    if (faultBreakdown.network_latency.injected > 0 || faultBreakdown.network_500.injected > 0) {
      synthesizedAntiPatterns.push(
        'On transient network timeouts or secondary API 500 errors, apply exponential backoff retry up to 2 attempts before declaring action failure.'
      );
    }

    if (faultBreakdown.stale_element.injected > 0) {
      synthesizedAntiPatterns.push(
        'When element reference is detached from DOM, refresh page observation snapshot and re-resolve locator before retrying action.'
      );
    }

    // Optionally persist synthesized anti-patterns into domain playbooks
    if (this.playbookRepo && synthesizedAntiPatterns.length > 0) {
      try {
        const now = new Date().toISOString();
        for (const [idx, rule] of synthesizedAntiPatterns.entries()) {
          this.playbookRepo.savePlaybook({
            id: `chaos_pb_${domain}_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 7)}`,
            domain,
            pattern_type: 'anti_pattern',
            pattern_key: `chaos_resilience_${idx}`,
            playbook_data: JSON.stringify({ strategy: rule }),
            success_count: passedTrials,
            last_applied_at: now,
            created_at: now,
          });
        }
        this.logger?.info(
          'ResilienceAuditor',
          `Persisted ${synthesizedAntiPatterns.length} chaos resilience rules for domain [${domain}]`
        );
      } catch (err) {
        this.logger?.warn('ResilienceAuditor', `Failed to persist playbook rules: ${String(err)}`);
      }
    }

    return {
      totalTrials,
      passedTrials,
      overallPassRate,
      averageResilienceScore,
      averageSteps,
      averageDurationMs,
      faultBreakdown,
      synthesizedAntiPatterns,
    };
  }

  public generateReport(summary: ResilienceSummary, trials: GauntletTrialResult[]): ResilienceReport {
    const timestamp = new Date().toISOString();

    const markdownReport = [
      `# Adversarial Chaos Gauntlet Resilience Report`,
      `**Generated:** ${timestamp}`,
      `**Total Trials:** ${summary.totalTrials} | **Pass Rate:** ${(summary.overallPassRate * 100).toFixed(1)}% | **Mean Resilience Score:** ${summary.averageResilienceScore.toFixed(2)}/1.00`,
      ``,
      `## Fault Recovery Breakdown`,
      `| Chaos Fault Type | Injected | Recovered | Recovery Rate |`,
      `|---|---|---|---|`,
      ...Object.entries(summary.faultBreakdown).map(([fault, metric]) => {
        const rate = metric.injected > 0 ? ((metric.recovered / metric.injected) * 100).toFixed(1) : 'N/A';
        return `| \`${fault}\` | ${metric.injected} | ${metric.recovered} | ${rate}% |`;
      }),
      ``,
      `## Synthesized Playbook Anti-Patterns & Hardened Rules`,
      ...summary.synthesizedAntiPatterns.map((rule, idx) => `${idx + 1}. ${rule}`),
      ``,
      `## Trial Execution Logs`,
      `| Trial ID | Scenario | Chaos Level | Status | Steps | Duration | Interventions | Score |`,
      `|---|---|---|---|---|---|---|---|`,
      ...trials.map((t) => {
        const status = t.success ? '✅ PASS' : '❌ FAIL';
        const interventions = t.interventionsTriggered.length > 0 ? t.interventionsTriggered.join(', ') : 'none';
        return `| \`${t.trialId}\` | ${t.scenarioName} | ${t.chaosLevel} | ${status} | ${t.stepsExecuted} | ${t.durationMs}ms | ${interventions} | ${t.resilienceScore.toFixed(2)} |`;
      }),
    ].join('\n');

    return {
      timestamp,
      summary,
      trials,
      markdownReport,
    };
  }
}

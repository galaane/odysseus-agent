import type { Page } from 'playwright-core';
import type { AgentLoop } from '../agent/AgentLoop.js';
import type { BrowserManager } from '../browser/BrowserManager.js';
import { ChaosInjector } from './ChaosInjector.js';
import { ResilienceAuditor } from './ResilienceAuditor.js';
import type {
  ChaosScenario,
  GauntletTrialResult,
  ResilienceReport,
  ChaosProfile,
} from './types.js';
import type { Logger } from '../logging/Logger.js';
import type { Task } from '../agent/Agent.js';

export interface ChaosGauntletRunnerOptions {
  agentLoop: AgentLoop;
  browserManager: BrowserManager;
  injector?: ChaosInjector;
  auditor?: ResilienceAuditor;
  logger?: Logger;
}

export class ChaosGauntletRunner {
  private readonly injector: ChaosInjector;
  private readonly auditor: ResilienceAuditor;

  constructor(private readonly options: ChaosGauntletRunnerOptions) {
    this.injector = options.injector || new ChaosInjector(options.logger);
    this.auditor = options.auditor || new ResilienceAuditor(undefined, options.logger);
  }

  public getInjector(): ChaosInjector {
    return this.injector;
  }

  public getAuditor(): ResilienceAuditor {
    return this.auditor;
  }

  /**
   * Runs a single benchmark scenario under active chaos injection and computes trial metrics.
   */
  public async runScenario(scenario: ChaosScenario): Promise<GauntletTrialResult> {
    const trialId = `trial_${scenario.id}_${Date.now()}`;
    const startTime = Date.now();
    this.injector.clearInjectedFaults();

    this.options.logger?.info(
      'ChaosGauntletRunner',
      `Starting trial [${trialId}] for scenario "${scenario.name}" (level: ${scenario.profile.level})`
    );

    const pageManager = this.options.browserManager.getPageManager();
    let page: Page;
    try {
      page = pageManager.getActivePage();
    } catch {
      const browserCtx = this.options.browserManager.getContext();
      if (!browserCtx) {
        throw new Error('Browser context not initialized');
      }
      page = await browserCtx.newPage();
    }

    // Attach network interception chaos
    const networkTeardown = await this.injector.attachNetworkChaos(page, scenario.profile);

    const interventionsTriggered: string[] = [];
    const unhandledErrors: string[] = [];
    let success = false;
    let stepsExecuted = 0;

    try {
      // Step-0 perturbation if modal/banner is active in profile
      if (
        scenario.profile.activeFaults.includes('cookie_banner_injection') ||
        scenario.profile.activeFaults.includes('promo_modal_injection')
      ) {
        await this.injector.stepPerturbation(page, scenario.profile);
      }

      const task: Task = {
        id: trialId,
        goal: scenario.taskGoal,
        maxSteps: 8,
        maxDurationMs: 45_000,
      };

      const result = await this.options.agentLoop.run(task);
      stepsExecuted = result.steps;
      success = result.status === 'completed';

      if (scenario.expectedSuccessAssertion) {
        success = success && scenario.expectedSuccessAssertion(result);
      }

      if (this.injector.getInjectedFaults().length > 0) {
        interventionsTriggered.push('chaos_recovery_ladder');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      unhandledErrors.push(message);
      this.options.logger?.error('ChaosGauntletRunner', `Scenario trial error: ${message}`);
    } finally {
      await networkTeardown().catch(() => {});
    }

    const durationMs = Date.now() - startTime;
    const faultsInjected = this.injector.getInjectedFaults();

    const resilienceScore = this.auditor.computeTrialScore({
      success,
      unhandledErrors,
      interventionsTriggered,
    });

    const trialResult: GauntletTrialResult = {
      trialId,
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      chaosLevel: scenario.profile.level,
      success,
      stepsExecuted,
      durationMs,
      faultsInjected,
      interventionsTriggered,
      unhandledErrors,
      resilienceScore,
    };

    this.options.logger?.info(
      'ChaosGauntletRunner',
      `Trial [${trialId}] finished. Success: ${success} (Score: ${resilienceScore.toFixed(2)}, Faults: ${faultsInjected.length})`
    );

    return trialResult;
  }

  /**
   * Executes a gauntlet sequence across all provided scenarios and generates a comprehensive resilience report.
   */
  public async runGauntlet(scenarios: ChaosScenario[]): Promise<ResilienceReport> {
    const trials: GauntletTrialResult[] = [];

    this.options.logger?.info(
      'ChaosGauntletRunner',
      `Starting Adversarial Chaos Gauntlet suite (${scenarios.length} scenarios)...`
    );

    for (const scenario of scenarios) {
      const trial = await this.runScenario(scenario);
      trials.push(trial);
    }

    const summary = this.auditor.auditTrials(trials);
    const report = this.auditor.generateReport(summary, trials);

    this.options.logger?.info(
      'ChaosGauntletRunner',
      `Adversarial Gauntlet completed. Pass Rate: ${(summary.overallPassRate * 100).toFixed(1)}%, Mean Score: ${summary.averageResilienceScore.toFixed(2)}/1.00`
    );

    return report;
  }

  /**
   * Helper to construct pre-packaged benchmark chaos profiles.
   */
  public static createProfile(level: 'mild' | 'moderate' | 'extreme'): ChaosProfile {
    switch (level) {
      case 'mild':
        return {
          level: 'mild',
          activeFaults: ['network_latency'],
          faultProbability: 0.3,
          networkLatencyMs: { min: 200, max: 600 },
        };
      case 'moderate':
        return {
          level: 'moderate',
          activeFaults: ['network_latency', 'network_500', 'cookie_banner_injection'],
          faultProbability: 0.5,
          networkLatencyMs: { min: 400, max: 1200 },
          mutationIntensity: 2,
        };
      case 'extreme':
        return {
          level: 'extreme',
          activeFaults: [
            'network_latency',
            'network_500',
            'cookie_banner_injection',
            'promo_modal_injection',
            'dom_mutation',
            'stale_element',
          ],
          faultProbability: 0.7,
          networkLatencyMs: { min: 800, max: 2000 },
          mutationIntensity: 5,
        };
    }
  }
}

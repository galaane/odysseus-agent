import type { BrowserManager } from '../browser/BrowserManager.js';
import type { ActionMutex } from '../browser/ActionMutex.js';
import type { WatcherRepository } from '../persistence/WatcherRepository.js';
import type { WorkflowMacroRepository } from '../persistence/WorkflowMacroRepository.js';
import type { MacroExecutor } from '../macros/MacroExecutor.js';
import type { EventLogger } from '../logging/EventLogger.js';
import type { Logger } from '../logging/Logger.js';
import { ConditionEvaluator } from './ConditionEvaluator.js';
import type {
  WatcherJob,
  WatcherEvaluationResult,
  WatcherTriggerHandler,
} from './types.js';

export interface StateWatcherEngineOptions {
  browserManager: BrowserManager;
  actionMutex: ActionMutex;
  watcherRepo: WatcherRepository;
  conditionEvaluator?: ConditionEvaluator;
  macroExecutor?: MacroExecutor;
  macroRepo?: WorkflowMacroRepository;
  eventLogger?: EventLogger;
  logger?: Logger;
  onTrigger?: WatcherTriggerHandler;
}

export class StateWatcherEngine {
  private readonly browserManager: BrowserManager;
  private readonly actionMutex: ActionMutex;
  private readonly watcherRepo: WatcherRepository;
  private readonly conditionEvaluator: ConditionEvaluator;
  private readonly macroExecutor?: MacroExecutor;
  private readonly macroRepo?: WorkflowMacroRepository;
  private readonly eventLogger?: EventLogger;
  private readonly logger?: Logger;
  private readonly onTrigger?: WatcherTriggerHandler;

  private activeTimers = new Map<string, NodeJS.Timeout>();
  private isRunning = false;

  constructor(options: StateWatcherEngineOptions) {
    this.browserManager = options.browserManager;
    this.actionMutex = options.actionMutex;
    this.watcherRepo = options.watcherRepo;
    this.conditionEvaluator = options.conditionEvaluator || new ConditionEvaluator(options.logger);
    this.macroExecutor = options.macroExecutor;
    this.macroRepo = options.macroRepo;
    this.eventLogger = options.eventLogger;
    this.logger = options.logger;
    this.onTrigger = options.onTrigger;
  }

  /**
   * Starts the watcher daemon, restoring and scheduling all active jobs from the repository.
   */
  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    this.logger?.info('StateWatcherEngine', 'Starting StateWatcherEngine daemon...');
    const activeJobs = this.watcherRepo.getActiveJobs();
    for (const job of activeJobs) {
      this.scheduleNextCheck(job);
    }
  }

  /**
   * Stops the watcher daemon and clears all scheduled interval timers.
   */
  public stop(): void {
    this.isRunning = false;
    for (const [jobId, timer] of this.activeTimers.entries()) {
      clearTimeout(timer);
      this.activeTimers.delete(jobId);
    }
    this.logger?.info('StateWatcherEngine', 'StateWatcherEngine daemon stopped.');
  }

  /**
   * Registers and immediately schedules a new watcher job.
   */
  public addJob(job: WatcherJob): void {
    this.watcherRepo.saveJob(job);
    this.logger?.info(
      'StateWatcherEngine',
      `Registered watcher job [${job.id}]: "${job.name}" on ${job.targetUrl} (condition: ${job.conditionType})`
    );

    if (this.isRunning && job.status === 'active') {
      this.scheduleNextCheck(job);
    }
  }

  /**
   * Removes and cancels a watcher job.
   */
  public removeJob(id: string): void {
    const timer = this.activeTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.activeTimers.delete(id);
    }
    this.watcherRepo.deleteJob(id);
    this.logger?.info('StateWatcherEngine', `Removed watcher job [${id}]`);
  }

  /**
   * Pauses an active watcher job.
   */
  public pauseJob(id: string): void {
    const timer = this.activeTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.activeTimers.delete(id);
    }
    this.watcherRepo.updateJobStatus(id, 'paused');
    this.logger?.info('StateWatcherEngine', `Paused watcher job [${id}]`);
  }

  /**
   * Resumes a paused watcher job.
   */
  public resumeJob(id: string): void {
    const job = this.watcherRepo.getJob(id);
    if (!job) return;

    this.watcherRepo.updateJobStatus(id, 'active');
    if (this.isRunning) {
      this.scheduleNextCheck({ ...job, status: 'active' });
    }
    this.logger?.info('StateWatcherEngine', `Resumed watcher job [${id}]`);
  }

  /**
   * Calculates the next delay with optional adaptive jitter (+/- 20%).
   */
  public calculateNextInterval(intervalMs: number, adaptiveJitter: boolean): number {
    if (!adaptiveJitter) return intervalMs;
    // Jitter multiplier between 0.8 and 1.2
    const jitterMultiplier = 0.8 + Math.random() * 0.4;
    return Math.max(1000, Math.round(intervalMs * jitterMultiplier));
  }

  /**
   * Schedules the next evaluation tick for a given job.
   */
  private scheduleNextCheck(job: WatcherJob, customDelayMs?: number): void {
    // Clear existing timer if any
    const existing = this.activeTimers.get(job.id);
    if (existing) {
      clearTimeout(existing);
      this.activeTimers.delete(job.id);
    }

    if (!this.isRunning || job.status !== 'active') return;

    // Check expiration
    if (job.expiresAt && Date.now() > job.expiresAt) {
      this.watcherRepo.updateJobStatus(job.id, 'expired');
      this.logger?.info('StateWatcherEngine', `Watcher job [${job.id}] expired.`);
      return;
    }

    const delay = customDelayMs ?? this.calculateNextInterval(job.intervalMs, job.adaptiveJitter);
    const timer = setTimeout(async () => {
      try {
        await this.evaluateJob(job.id);
      } catch (err) {
        this.logger?.warn('StateWatcherEngine', `Error executing tick for job [${job.id}]: ${String(err)}`);
      }
    }, delay);

    this.activeTimers.set(job.id, timer);
  }

  /**
   * Evaluates a watcher job immediately using a mutex-guarded isolated background page.
   */
  public async evaluateJob(jobId: string): Promise<WatcherEvaluationResult> {
    const job = this.watcherRepo.getJob(jobId);
    if (!job || job.status !== 'active') {
      return {
        jobId,
        conditionMet: false,
        currentObservedValue: null,
        dispatched: false,
        timestamp: Date.now(),
        error: 'Job not found or not active',
      };
    }

    const checkTimestamp = Date.now();
    this.watcherRepo.recordCheck(job.id, checkTimestamp);

    return this.actionMutex.runExclusive(async () => {
      let backgroundPage: import('playwright-core').Page | undefined;
      try {
        const context = this.browserManager.getContext();
        if (!context) {
          throw new Error('Browser context not available');
        }

        // Open an isolated background page
        backgroundPage = await context.newPage();

        // Navigate with a sensible timeout
        await backgroundPage.goto(job.targetUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });

        // Small grace period for dynamic hydration
        await backgroundPage.waitForTimeout(500);

        const evaluation = await this.conditionEvaluator.evaluateOnPage(backgroundPage, job);

        let dispatched = false;
        if (evaluation.conditionMet) {
          this.logger?.info(
            'StateWatcherEngine',
            `Condition MET for watcher job [${job.id}]: observed "${String(evaluation.observedValue)}"`
          );

          // Mark job as triggered
          this.watcherRepo.updateJobStatus(job.id, 'triggered', checkTimestamp);

          // Remove scheduled timer
          const timer = this.activeTimers.get(job.id);
          if (timer) {
            clearTimeout(timer);
            this.activeTimers.delete(job.id);
          }

          // Dispatch trigger
          dispatched = await this.dispatchTrigger(job, {
            jobId: job.id,
            conditionMet: true,
            currentObservedValue: evaluation.observedValue,
            dispatched: false,
            timestamp: checkTimestamp,
          });
        } else {
          // Re-schedule next check if job remains active
          if (this.isRunning && job.status === 'active') {
            this.scheduleNextCheck(job);
          }
        }

        return {
          jobId: job.id,
          conditionMet: evaluation.conditionMet,
          currentObservedValue: evaluation.observedValue,
          dispatched,
          timestamp: checkTimestamp,
          error: evaluation.error,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger?.warn('StateWatcherEngine', `Evaluation failed for job [${job.id}]: ${msg}`);

        // Even on error, re-schedule next check if active
        if (this.isRunning && job.status === 'active') {
          this.scheduleNextCheck(job);
        }

        return {
          jobId: job.id,
          conditionMet: false,
          currentObservedValue: null,
          dispatched: false,
          timestamp: checkTimestamp,
          error: msg,
        };
      } finally {
        if (backgroundPage) {
          await backgroundPage.close().catch(() => {});
        }
      }
    });
  }

  /**
   * Dispatches trigger actions when a watcher condition is satisfied.
   */
  private async dispatchTrigger(
    job: WatcherJob,
    result: WatcherEvaluationResult
  ): Promise<boolean> {
    this.eventLogger?.emit('task.created', {
      event: 'watcher_triggered',
      jobId: job.id,
      name: job.name,
      targetUrl: job.targetUrl,
      triggerType: job.triggerType,
      observedValue: result.currentObservedValue,
    });

    // Custom trigger handler callback
    if (this.onTrigger) {
      try {
        await this.onTrigger(job, result);
      } catch (err) {
        this.logger?.warn('StateWatcherEngine', `Trigger callback error for job [${job.id}]: ${String(err)}`);
      }
    }

    // Built-in Macro execution trigger
    if (job.triggerType === 'execute_macro' && this.macroExecutor && this.macroRepo) {
      const macroId = String(job.triggerPayload?.macroId || '');
      if (macroId) {
        const macro = this.macroRepo.getMacroById(macroId);
        if (macro) {
          try {
            const context = this.browserManager.getContext();
            if (context) {
              const macroPage = await context.newPage();
              const activeTab = this.browserManager.getTabManager().getActiveTab();
              const tabId = activeTab ? activeTab.id : 'tab_watcher_macro';
              const rawParams = (job.triggerPayload?.params as Record<string, unknown>) || {};
              const strParams: Record<string, string> = {};
              for (const [k, v] of Object.entries(rawParams)) {
                strParams[k] = String(v);
              }
              await this.macroExecutor.executeMacro(macro, strParams, {
                page: macroPage,
                tabId,
                taskId: `watcher_${job.id}`,
              });
            }
          } catch (err) {
            this.logger?.warn('StateWatcherEngine', `Failed to execute macro [${macroId}]: ${String(err)}`);
          }
        }
      }
    }

    return true;
  }

  public getWatcherRepo(): WatcherRepository {
    return this.watcherRepo;
  }

  public getConditionEvaluator(): ConditionEvaluator {
    return this.conditionEvaluator;
  }

  public getActiveTimerCount(): number {
    return this.activeTimers.size;
  }
}

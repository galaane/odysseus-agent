import type { Page } from 'playwright-core';
import type { BrowserManager } from '../browser/BrowserManager.js';
import type { ActionRegistry } from '../actions/ActionRegistry.js';
import type { PageObserver } from '../observer/PageObserver.js';
import type { WorkflowMacroRepository } from '../persistence/WorkflowMacroRepository.js';
import type { SelfHealingPipeline } from './SelfHealingPipeline.js';
import type { WorkflowMacro, MacroExecutionResult } from './types.js';
import { ActionValidator } from '../actions/ActionValidator.js';
import type { ActionExecutionContext } from '../actions/ActionExecutionContext.js';
import type { BrowserAction } from '../actions/Action.js';
import type { Logger } from '../logging/Logger.js';

export interface MacroExecutorOptions {
  browserManager: BrowserManager;
  actionRegistry: ActionRegistry;
  pageObserver: PageObserver;
  macroRepo?: WorkflowMacroRepository;
  healingPipeline: SelfHealingPipeline;
  logger: Logger;
  maxHealingAttemptsPerStep?: number;
}

export class MacroExecutor {
  private maxHealingAttempts: number;

  constructor(private readonly options: MacroExecutorOptions) {
    this.maxHealingAttempts = options.maxHealingAttemptsPerStep ?? 2;
  }

  /**
   * Executes a parameterized workflow macro deterministically under the ActionMutex.
   */
  public async executeMacro(
    macro: WorkflowMacro,
    parameters: Record<string, string>,
    context: {
      page: Page;
      tabId: string;
      taskId: string;
    }
  ): Promise<MacroExecutionResult> {
    const startTime = Date.now();
    let executedSteps = 0;
    let healedCount = 0;

    this.options.logger.info(
      'MacroExecutor',
      `Starting deterministic execution of macro [${macro.id}] (${macro.steps.length} steps) for tab ${context.tabId}`
    );

    try {
      for (let i = 0; i < macro.steps.length; i++) {
        const step = macro.steps[i];
        let stepSuccess = false;
        let healingAttempts = 0;

        while (!stepSuccess && healingAttempts <= this.maxHealingAttempts) {
          const actionToRun = this.interpolateAction(step.actionTemplate, parameters);
          ActionValidator.validate(actionToRun);

          const execContext: ActionExecutionContext = {
            page: context.page,
            tabId: context.tabId,
            browserManager: this.options.browserManager,
            logger: this.options.logger,
            elementResolver: this.options.pageObserver.getRegistry(),
            taskId: context.taskId,
          };

          const result = await this.options.actionRegistry.dispatch(actionToRun, execContext);

          if (result.success) {
            stepSuccess = true;
            executedSteps++;
          } else {
            healingAttempts++;
            this.options.logger.warn(
              'MacroExecutor',
              `Macro step #${step.stepNumber} failed: ${result.error?.message}. Attempting self-healing (${healingAttempts}/${this.maxHealingAttempts})...`
            );

            if (healingAttempts <= this.maxHealingAttempts) {
              // Refresh observation snapshot to populate active ElementRegistry
              await this.options.pageObserver.observePage(context.page, context.tabId);

              const healResult = await this.options.healingPipeline.healStep(
                macro,
                i,
                this.options.pageObserver.getRegistry()
              );

              if (healResult.healed && healResult.updatedStep) {
                macro.steps[i] = healResult.updatedStep;
                healedCount++;
                this.options.logger.info(
                  'MacroExecutor',
                  `Step #${step.stepNumber} self-healed via Tier ${healResult.tierUsed}. Retrying step execution...`
                );
              } else {
                break; // Healing could not resolve target
              }
            }
          }
        }

        if (!stepSuccess) {
          const durationMs = Date.now() - startTime;
          this.options.macroRepo?.recordFailure(macro.id);
          this.options.logger.warn(
            'MacroExecutor',
            `Macro [${macro.id}] halted at step #${step.stepNumber}. Falling back to System 2 deliberative loop.`
          );

          return {
            success: false,
            macroId: macro.id,
            executedSteps,
            healedCount,
            failedStepIndex: i,
            error: new Error(`Macro step #${step.stepNumber} execution failed after ${healingAttempts} healing attempts`),
            durationMs,
          };
        }
      }

      const durationMs = Date.now() - startTime;
      this.options.macroRepo?.recordSuccess(macro.id);
      this.options.logger.info(
        'MacroExecutor',
        `Macro [${macro.id}] completed successfully in ${durationMs}ms (${executedSteps} steps, ${healedCount} healed)`
      );

      return {
        success: true,
        macroId: macro.id,
        executedSteps,
        healedCount,
        durationMs,
      };
    } catch (err: unknown) {
      const durationMs = Date.now() - startTime;
      this.options.macroRepo?.recordFailure(macro.id);
      const error = err instanceof Error ? err : new Error(String(err));

      return {
        success: false,
        macroId: macro.id,
        executedSteps,
        healedCount,
        error,
        durationMs,
      };
    }
  }

  /**
   * Recursively replaces {{paramKey}} placeholders with provided parameter values.
   */
  public interpolateAction(
    actionTemplate: BrowserAction | Record<string, unknown>,
    parameters: Record<string, string>
  ): BrowserAction {
    const json = JSON.stringify(actionTemplate);
    const interpolatedJson = json.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
      return parameters[key] !== undefined ? parameters[key] : '';
    });

    return JSON.parse(interpolatedJson) as BrowserAction;
  }
}

import type { BrowserAction } from '../actions/Action.js';
import type { ElementRegistry } from '../observer/ElementRegistry.js';
import type { WorkflowMacroRepository } from '../persistence/WorkflowMacroRepository.js';
import type { WorkflowMacro, ParameterizedMacroStep, IntentExtractionResult } from './types.js';
import type { Task } from '../agent/Agent.js';
import type { Logger } from '../logging/Logger.js';

export class MacroSynthesizer {
  constructor(
    private readonly macroRepo?: WorkflowMacroRepository,
    private readonly logger?: Logger
  ) {}

  /**
   * Analyzes a task goal to extract recognized intent categories and dynamic variables.
   */
  public extractIntent(goal: string): IntentExtractionResult {
    const trimmed = goal.trim();

    // 1. Search / Query intent
    const searchMatch = trimmed.match(
      /(?:find|search(?: for)?|look for)\s+(?:pricing for\s+|information on\s+|products?\s+)?["']?([^"'\n\r]+)["']?/i
    );
    if (searchMatch && searchMatch[1]) {
      const query = searchMatch[1].trim().replace(/[.?]$/, '');
      return {
        intentKey: 'catalog_search',
        parameters: { query },
        isParametric: true,
      };
    }

    // 2. Authentication Login intent
    if (/(?:log ?in|sign ?in|authenticate)/i.test(trimmed)) {
      return {
        intentKey: 'account_login',
        parameters: {},
        isParametric: false,
      };
    }

    // 3. Checkout / Purchase intent
    if (/(?:checkout|buy now|place order|purchase)/i.test(trimmed)) {
      return {
        intentKey: 'cart_checkout',
        parameters: {},
        isParametric: false,
      };
    }

    // 4. Filter / Sort intent
    const filterMatch = trimmed.match(/(?:filter by|sort by)\s+["']?([^"'\n\r]+)["']?/i);
    if (filterMatch && filterMatch[1]) {
      return {
        intentKey: 'catalog_filter',
        parameters: { filter: filterMatch[1].trim().replace(/[.?]$/, '') },
        isParametric: true,
      };
    }

    return {
      intentKey: 'general_workflow',
      parameters: {},
      isParametric: false,
    };
  }

  /**
   * Synthesizes a parameterized WorkflowMacro from a completed trajectory.
   */
  public synthesizeFromTrajectory(
    task: Task,
    domain: string,
    executedActions: BrowserAction[],
    options?: { elementRegistry?: ElementRegistry }
  ): WorkflowMacro | null {
    if (!executedActions || executedActions.length < 2) {
      return null;
    }

    // Do not synthesize macros containing sensitive credentials or destructive actions
    const hasDestructiveAction = executedActions.some((a) => {
      if (a.type === 'close_tab') return true;
      if (a.type === 'click') {
        const el = options?.elementRegistry?.get(a.targetId);
        if (el && /\b(delete|destroy|terminate|wipe)\b/i.test(el.name)) return true;
      }
      return false;
    });

    if (hasDestructiveAction) {
      this.logger?.debug('MacroSynthesizer', 'Skipping macro synthesis: Trajectory contains destructive actions.');
      return null;
    }

    const { intentKey, parameters } = this.extractIntent(task.goal);
    const parameterKeys = Object.keys(parameters);

    const steps: ParameterizedMacroStep[] = executedActions.map((action, index) => {
      let actionTemplate: Record<string, unknown> = { ...action };

      // Parameterize matching text values
      if (action.type === 'fill' || action.type === 'type') {
        const val = action.type === 'fill' ? action.value : action.text;
        for (const [key, paramVal] of Object.entries(parameters)) {
          if (paramVal && val.toLowerCase() === paramVal.toLowerCase()) {
            if (action.type === 'fill') {
              actionTemplate = { ...actionTemplate, value: `{{${key}}}` };
            } else {
              actionTemplate = { ...actionTemplate, text: `{{${key}}}` };
            }
          }
        }
      }

      // Capture primary element metadata and fallback locator strategies
      let primaryTargetRole: string | undefined;
      let primaryTargetName: string | undefined;
      let primaryTargetId: string | undefined;
      const fallbackSelectors: string[] = [];

      if ('targetId' in action && typeof action.targetId === 'string') {
        primaryTargetId = action.targetId;
        const registered = options?.elementRegistry?.get(action.targetId);
        if (registered) {
          primaryTargetRole = registered.role;
          primaryTargetName = registered.name;
          if (registered.locatorStrategy?.selector) {
            fallbackSelectors.push(registered.locatorStrategy.selector);
          }
        }
      }

      return {
        stepNumber: index + 1,
        actionTemplate: actionTemplate as BrowserAction,
        primaryTargetRole,
        primaryTargetName,
        primaryTargetId,
        fallbackSelectors,
      };
    });

    const cleanDomain = domain.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const macroId = `macro_${cleanDomain}_${intentKey}`;
    const now = new Date().toISOString();

    const macro: WorkflowMacro = {
      id: macroId,
      domain: domain.toLowerCase(),
      intentKey,
      parameterKeys,
      steps,
      status: 'provisional',
      successCount: 1,
      failureCount: 0,
      healingCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    if (this.macroRepo) {
      this.macroRepo.saveMacro(macro);
      this.logger?.info('MacroSynthesizer', `Synthesized new workflow macro [${macroId}] for ${domain} (${steps.length} steps)`);
    }

    return macro;
  }
}

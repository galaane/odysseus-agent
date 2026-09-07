import type { WaitAction } from '../Action.js';
import type { ActionExecutionContext } from '../ActionExecutionContext.js';
import { BrowserError, ErrorCodes } from '../../browser/BrowserError.js';

export class WaitHandler {
  public async execute(action: WaitAction, context: ActionExecutionContext): Promise<{ observationDelta?: unknown }> {
    const { page, logger } = context;
    const timeout = action.timeoutMs || 5000;

    logger.info('WaitHandler', `Waiting for condition "${action.condition}"`, { condition: action.condition, timeoutMs: timeout });

    try {
      switch (action.condition) {
        case 'timeout':
          await page.waitForTimeout(timeout);
          break;
        case 'network-idle':
          await page.waitForLoadState('networkidle', { timeout });
          break;
        case 'navigation':
          await page.waitForLoadState('load', { timeout });
          break;
        case 'selector':
          if (!action.selector) {
            throw new Error('Selector condition requires selector property to be set');
          }
          await page.waitForSelector(action.selector, { timeout });
          break;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new BrowserError(ErrorCodes.ACTION_TIMEOUT, `Wait condition "${action.condition}" failed: ${message}`);
    }

    return {
      observationDelta: {
        waitedCondition: action.condition,
      },
    };
  }
}

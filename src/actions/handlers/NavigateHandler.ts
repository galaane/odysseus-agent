import type { NavigateAction } from '../Action.js';
import type { ActionExecutionContext } from '../ActionExecutionContext.js';

export class NavigateHandler {
  public async execute(action: NavigateAction, context: ActionExecutionContext): Promise<{ observationDelta?: unknown }> {
    const { page, logger } = context;
    logger.info('NavigateHandler', `Navigating to ${action.url}`, { waitUntil: action.waitUntil, timeoutMs: action.timeoutMs });

    await page.goto(action.url, {
      waitUntil: action.waitUntil,
      timeout: action.timeoutMs,
    });

    const currentUrl = page.url();
    const title = await page.title().catch(() => '');

    return {
      observationDelta: {
        url: currentUrl,
        title,
      },
    };
  }
}

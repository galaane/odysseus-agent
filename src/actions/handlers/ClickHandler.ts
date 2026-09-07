import type { ClickAction } from '../Action.js';
import type { ActionExecutionContext } from '../ActionExecutionContext.js';
import { BrowserError, ErrorCodes } from '../../browser/BrowserError.js';

export class ClickHandler {
  public async execute(action: ClickAction, context: ActionExecutionContext): Promise<{ observationDelta?: unknown }> {
    const { page, elementResolver, logger } = context;
    logger.info('ClickHandler', `Clicking target ${action.targetId}`, { targetId: action.targetId });

    const locator = elementResolver
      ? elementResolver.resolveLocator(action.targetId, page)
      : page.locator(action.targetId);

    try {
      await locator.scrollIntoViewIfNeeded({ timeout: action.timeoutMs || 5000 });
      await locator.click({ timeout: action.timeoutMs || 10000 });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('not visible') || message.includes('hidden')) {
        throw new BrowserError(ErrorCodes.ELEMENT_NOT_VISIBLE, `Element ${action.targetId} is not visible to click: ${message}`);
      }
      if (message.includes('Timeout') || message.includes('timeout')) {
        throw new BrowserError(ErrorCodes.ACTION_TIMEOUT, `Click on element ${action.targetId} timed out: ${message}`);
      }
      throw new BrowserError(ErrorCodes.ELEMENT_NOT_INTERACTABLE, `Failed to click element ${action.targetId}: ${message}`);
    }

    return {
      observationDelta: {
        clickedTargetId: action.targetId,
        urlAfterClick: page.url(),
      },
    };
  }
}

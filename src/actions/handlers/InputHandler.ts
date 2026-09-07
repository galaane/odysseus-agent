import type { FillAction, TypeAction, PressAction } from '../Action.js';
import type { ActionExecutionContext } from '../ActionExecutionContext.js';
import { BrowserError, ErrorCodes } from '../../browser/BrowserError.js';

export class InputHandler {
  public async handleFill(action: FillAction, context: ActionExecutionContext): Promise<{ observationDelta?: unknown }> {
    const { page, elementResolver, logger } = context;
    logger.info('InputHandler', `Filling target ${action.targetId}`, { targetId: action.targetId });

    const locator = elementResolver
      ? elementResolver.resolveLocator(action.targetId, page)
      : page.locator(action.targetId);

    try {
      await locator.scrollIntoViewIfNeeded({ timeout: action.timeoutMs || 5000 });
      await locator.fill(action.value, { timeout: action.timeoutMs || 10000 });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new BrowserError(ErrorCodes.ELEMENT_NOT_INTERACTABLE, `Failed to fill target ${action.targetId}: ${message}`);
    }

    return {
      observationDelta: {
        targetId: action.targetId,
        filledLength: action.value.length,
      },
    };
  }

  public async handleType(action: TypeAction, context: ActionExecutionContext): Promise<{ observationDelta?: unknown }> {
    const { page, elementResolver, logger } = context;
    logger.info('InputHandler', `Typing into target ${action.targetId}`, { targetId: action.targetId, delayMs: action.delayMs });

    const locator = elementResolver
      ? elementResolver.resolveLocator(action.targetId, page)
      : page.locator(action.targetId);

    try {
      await locator.scrollIntoViewIfNeeded({ timeout: action.timeoutMs || 5000 });
      await locator.pressSequentially(action.text, {
        delay: action.delayMs,
        timeout: action.timeoutMs || 15000,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new BrowserError(ErrorCodes.ELEMENT_NOT_INTERACTABLE, `Failed to type into target ${action.targetId}: ${message}`);
    }

    return {
      observationDelta: {
        targetId: action.targetId,
        typedLength: action.text.length,
      },
    };
  }

  public async handlePress(action: PressAction, context: ActionExecutionContext): Promise<{ observationDelta?: unknown }> {
    const { page, elementResolver, logger } = context;
    logger.info('InputHandler', `Pressing key "${action.key}"`, { key: action.key, targetId: action.targetId });

    try {
      if (action.targetId) {
        const locator = elementResolver
          ? elementResolver.resolveLocator(action.targetId, page)
          : page.locator(action.targetId);
        await locator.press(action.key);
      } else {
        await page.keyboard.press(action.key);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new BrowserError(ErrorCodes.ACTION_TIMEOUT, `Failed to press key "${action.key}": ${message}`);
    }

    return {
      observationDelta: {
        pressedKey: action.key,
      },
    };
  }
}

import type { ScrollAction } from '../Action.js';
import type { ActionExecutionContext } from '../ActionExecutionContext.js';

export class ScrollHandler {
  public async execute(action: ScrollAction, context: ActionExecutionContext): Promise<{ observationDelta?: unknown }> {
    const { page, logger } = context;
    const deltaY = action.direction === 'down' ? action.amount : -action.amount;

    logger.info('ScrollHandler', `Scrolling ${action.direction} by ${action.amount}px`, { direction: action.direction, amount: action.amount });

    await page.mouse.wheel(0, deltaY);

    return {
      observationDelta: {
        scrolledDirection: action.direction,
        amount: action.amount,
      },
    };
  }
}

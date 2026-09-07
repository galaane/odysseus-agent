import type { ExtractAction } from '../Action.js';
import type { ActionExecutionContext } from '../ActionExecutionContext.js';

export class ExtractHandler {
  public async execute(action: ExtractAction, context: ActionExecutionContext): Promise<{ observationDelta?: unknown }> {
    const { page, elementResolver, logger } = context;
    logger.info('ExtractHandler', 'Extracting content', { targetId: action.targetId, instruction: action.instruction });

    let extractedText = '';

    if (action.targetId) {
      const locator = elementResolver
        ? elementResolver.resolveLocator(action.targetId, page)
        : page.locator(action.targetId);
      extractedText = (await locator.innerText().catch(() => locator.textContent())) || '';
    } else {
      extractedText = (await page.locator('body').innerText().catch(() => '')) || '';
    }

    return {
      observationDelta: {
        extractedText: extractedText.trim(),
        targetId: action.targetId,
      },
    };
  }
}

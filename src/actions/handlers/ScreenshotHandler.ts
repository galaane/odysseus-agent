import path from 'node:path';
import fs from 'node:fs';
import type { ScreenshotAction } from '../Action.js';
import type { ActionExecutionContext } from '../ActionExecutionContext.js';

export class ScreenshotHandler {
  public async execute(action: ScreenshotAction, context: ActionExecutionContext): Promise<{ observationDelta?: unknown }> {
    const { page, screenshotDir, taskId, logger } = context;
    const timestamp = Date.now();
    let savedPath: string | undefined;

    if (screenshotDir && taskId) {
      const taskFolder = path.resolve(screenshotDir, taskId);
      if (!fs.existsSync(taskFolder)) {
        fs.mkdirSync(taskFolder, { recursive: true });
      }
      savedPath = path.resolve(taskFolder, `step_${timestamp}.png`);
    }

    logger.info('ScreenshotHandler', 'Capturing screenshot', { fullPage: action.fullPage, path: savedPath });

    const buffer = await page.screenshot({
      fullPage: action.fullPage,
      path: savedPath,
    });

    return {
      observationDelta: {
        screenshotTaken: true,
        screenshotPath: savedPath,
        sizeBytes: buffer.length,
      },
    };
  }
}

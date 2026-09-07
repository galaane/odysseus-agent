import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { BrowserError, ErrorCodes } from '../browser/BrowserError.js';
import { SetOfMarksAnnotator } from './SetOfMarksAnnotator.js';
import type { RegisteredElement } from './ElementRegistry.js';

export interface ScreenshotOptions {
  taskId?: string;
  stepNumber?: number;
  customFileName?: string;
  fullPage?: boolean;
}

export class ScreenshotObserver {
  private baseDir: string;
  private annotator: SetOfMarksAnnotator = new SetOfMarksAnnotator();

  constructor(baseDir: string = path.resolve(process.cwd(), 'data', 'screenshots')) {
    this.baseDir = baseDir;
  }

  /**
   * Captures a screenshot from the page and saves it to data/screenshots/<taskId>/<filename>.png.
   * Returns the absolute path of the saved screenshot.
   */
  public async capture(page: Page, options?: ScreenshotOptions): Promise<string> {
    if (!page) {
      throw new BrowserError(ErrorCodes.BROWSER_NOT_CONNECTED, 'Cannot capture screenshot: page is null');
    }

    try {
      const targetDir = options?.taskId
        ? path.join(this.baseDir, options.taskId)
        : this.baseDir;

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      let fileName: string;
      if (options?.stepNumber !== undefined) {
        fileName = `step_${String(options.stepNumber).padStart(3, '0')}.png`;
      } else if (options?.customFileName) {
        fileName = options.customFileName.endsWith('.png') ? options.customFileName : `${options.customFileName}.png`;
      } else {
        fileName = `screenshot_${Date.now()}.png`;
      }

      const filePath = path.join(targetDir, fileName);

      await page.screenshot({
        path: filePath,
        fullPage: options?.fullPage ?? false,
      });

      return filePath;
    } catch (err: unknown) {
      if (err instanceof BrowserError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new BrowserError(
        ErrorCodes.ACTION_TIMEOUT,
        `Failed to capture screenshot: ${message}`,
        { error: message }
      );
    }
  }

  /**
   * Captures a screenshot from the page and returns it directly as a Base64-encoded string.
   */
  public async captureBase64(page: Page, options?: { fullPage?: boolean }): Promise<string> {
    if (!page) {
      throw new BrowserError(ErrorCodes.BROWSER_NOT_CONNECTED, 'Cannot capture screenshot: page is null');
    }

    try {
      const buffer = await page.screenshot({
        fullPage: options?.fullPage ?? false,
        type: 'png',
      });
      return buffer.toString('base64');
    } catch (err: unknown) {
      if (err instanceof BrowserError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new BrowserError(
        ErrorCodes.ACTION_TIMEOUT,
        `Failed to capture base64 screenshot: ${message}`,
        { error: message }
      );
    }
  }

  /**
   * Captures a screenshot annotated with visual Set-of-Marks (SoM) bounding boxes and ID badges,
   * returning it directly as a Base64-encoded string.
   */
  public async captureAnnotatedBase64(
    page: Page,
    elements: RegisteredElement[],
    options?: { fullPage?: boolean }
  ): Promise<string> {
    if (!page) {
      throw new BrowserError(ErrorCodes.BROWSER_NOT_CONNECTED, 'Cannot capture screenshot: page is null');
    }

    return this.annotator.annotateAndCapture(page, elements, async () => {
      return this.captureBase64(page, options);
    });
  }

  /**
   * Returns the SetOfMarksAnnotator instance.
   */
  public getAnnotator(): SetOfMarksAnnotator {
    return this.annotator;
  }

  /**
   * Returns the base directory for screenshots.
   */
  public getBaseDir(): string {
    return this.baseDir;
  }
}

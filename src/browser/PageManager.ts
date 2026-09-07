import type { Dialog, Frame, Page } from 'playwright-core';
import { TabManager } from './TabManager.js';
import { BrowserEventEmitter } from './BrowserEvents.js';
import { BrowserError, ErrorCodes } from './BrowserError.js';
import { Logger } from '../logging/Logger.js';

export type DialogPolicy = 'dismiss' | 'accept';

export interface DialogConfig {
  policy: DialogPolicy;
  promptText?: string;
}

export class PageManager {
  private dialogConfig: DialogConfig = { policy: 'dismiss' };
  private dialogListenersAttached = new WeakSet<Page>();

  constructor(
    private tabManager: TabManager,
    private emitter: BrowserEventEmitter,
    private logger: Logger
  ) {}

  /**
   * Sets the global policy for auto-handling native browser dialogs (alert, confirm, prompt).
   */
  public setDialogPolicy(policy: DialogPolicy, promptText?: string): void {
    this.dialogConfig = { policy, promptText };
    this.logger.info('PageManager', `Dialog policy updated to: ${policy}`);
  }

  /**
   * Attaches auto-dismiss / auto-accept dialog handlers to a page.
   */
  public attachPageHandlers(page: Page): void {
    if (this.dialogListenersAttached.has(page)) {
      return;
    }
    this.dialogListenersAttached.add(page);

    page.on('dialog', async (dialog: Dialog) => {
      const tabId = this.tabManager.getTabIdForPage(page);
      const dialogInfo = {
        type: dialog.type(),
        message: dialog.message(),
        defaultPrompt: dialog.defaultValue(),
        tabId,
      };

      this.logger.warn('PageManager', `Browser dialog appeared: [${dialog.type()}] "${dialog.message()}"`, dialogInfo);
      this.emitter.emitEvent('dialog.opened', dialogInfo);

      try {
        if (this.dialogConfig.policy === 'accept') {
          await dialog.accept(this.dialogConfig.promptText);
        } else {
          await dialog.dismiss();
        }
      } catch (err: unknown) {
        this.logger.error('PageManager', `Failed to handle dialog: ${String(err)}`);
      }
    });

    page.on('crash', () => {
      const tabId = this.tabManager.getTabIdForPage(page);
      this.logger.error('PageManager', `Page crashed for tab ${tabId}`);
    });
  }

  /**
   * Returns the current active Playwright Page, attaching handlers if not yet attached.
   */
  public getActivePage(): Page {
    const page = this.tabManager.getActivePage();
    this.attachPageHandlers(page);
    return page;
  }

  /**
   * Navigates the active page to a URL with configurable wait condition.
   */
  public async navigate(
    url: string,
    waitUntil: 'load' | 'domcontentloaded' | 'networkidle' = 'load',
    timeoutMs?: number
  ): Promise<void> {
    const page = this.getActivePage();
    const tabId = this.tabManager.getTabIdForPage(page) || 'unknown';

    this.emitter.emitEvent('navigation.started', { tabId, url });
    this.logger.info('PageManager', `Navigating ${tabId} to ${url}`, { url, waitUntil, timeoutMs });

    try {
      await page.goto(url, { waitUntil, timeout: timeoutMs });
      const title = await page.title().catch(() => '');
      this.emitter.emitEvent('navigation.completed', { tabId, url: page.url(), title });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('Timeout') || message.includes('timeout')) {
        throw new BrowserError(ErrorCodes.NAVIGATION_TIMEOUT, `Navigation to ${url} timed out: ${message}`, { url, timeoutMs });
      }
      throw new BrowserError(ErrorCodes.PAGE_TIMEOUT, `Navigation to ${url} failed: ${message}`, { url });
    }
  }

  /**
   * Returns all active frames for the current page.
   */
  public getFrames(): Frame[] {
    const page = this.getActivePage();
    return page.frames();
  }

  /**
   * Returns the page title of the active tab.
   */
  public async getTitle(): Promise<string> {
    const page = this.getActivePage();
    return await page.title();
  }

  /**
   * Returns the current URL of the active tab.
   */
  public getUrl(): string {
    const page = this.getActivePage();
    return page.url();
  }
}

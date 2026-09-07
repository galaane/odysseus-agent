import type { Page } from 'playwright-core';
import { ElementRegistry } from './ElementRegistry.js';
import { AccessibilityObserver } from './AccessibilityObserver.js';
import { DOMObserver } from './DOMObserver.js';
import { ObservationCompressor } from './ObservationCompressor.js';
import { ScreenshotObserver, type ScreenshotOptions } from './ScreenshotObserver.js';
import { NetworkObserver } from './NetworkObserver.js';
import type { PageSnapshot } from './PageSnapshot.js';
import { BrowserError, ErrorCodes } from '../browser/BrowserError.js';

export interface ObservationOptions {
  maxTokens?: number;
  captureScreenshot?: boolean;
  screenshotOptions?: ScreenshotOptions;
}

export class PageObserver {
  private elementRegistry: ElementRegistry;
  private accessibilityObserver: AccessibilityObserver;
  private domObserver: DOMObserver;
  private compressor: ObservationCompressor;
  private screenshotObserver: ScreenshotObserver;
  private networkObserver: NetworkObserver;

  constructor(
    elementRegistry?: ElementRegistry,
    accessibilityObserver?: AccessibilityObserver,
    domObserver?: DOMObserver,
    compressor?: ObservationCompressor,
    screenshotObserver?: ScreenshotObserver,
    networkObserver?: NetworkObserver
  ) {
    this.elementRegistry = elementRegistry || new ElementRegistry();
    this.accessibilityObserver = accessibilityObserver || new AccessibilityObserver();
    this.domObserver = domObserver || new DOMObserver();
    this.compressor = compressor || new ObservationCompressor();
    this.screenshotObserver = screenshotObserver || new ScreenshotObserver();
    this.networkObserver = networkObserver || new NetworkObserver();
  }

  /**
   * Captures a complete structured PageSnapshot from the active page.
   */
  public async observePage(
    page: Page,
    activeTabId: string,
    options?: ObservationOptions
  ): Promise<PageSnapshot> {
    if (!page) {
      throw new BrowserError(ErrorCodes.BROWSER_NOT_CONNECTED, 'Cannot observe page: page is null');
    }

    // 1. Reset the element registry for the active page
    this.elementRegistry.reset(page);

    // 2. Extract visible interactive elements via AccessibilityObserver
    const interactiveElements = await this.accessibilityObserver.observe(page, this.elementRegistry);

    // 3. Extract structural summary (headings, forms, links, notices) via DOMObserver
    const pageSummary = await this.domObserver.observe(page, this.elementRegistry);

    // 4. Extract page metadata
    const title = await page.title().catch(() => '');
    const url = page.url();

    // 5. Ensure network observer is attached and retrieve network activity
    this.networkObserver.attachToPage(page, activeTabId);
    const networkSummary = this.networkObserver.getNetworkSummary(activeTabId || page);

    // 6. Compress observation into token-budgeted markdown
    const compressedObservationText = this.compressor.compress({
      title,
      url,
      elements: interactiveElements,
      summary: pageSummary,
      networkSummary,
      maxTokens: options?.maxTokens,
    });

    // 7. Optional screenshot capture
    if (options?.captureScreenshot) {
      await this.screenshotObserver.capture(page, options.screenshotOptions);
    }

    return {
      timestamp: new Date().toISOString(),
      url,
      title,
      activeTabId,
      interactiveElements,
      pageSummary,
      compressedObservationText,
      networkSummary,
    };
  }

  public getRegistry(): ElementRegistry {
    return this.elementRegistry;
  }

  public getCompressor(): ObservationCompressor {
    return this.compressor;
  }

  public getScreenshotObserver(): ScreenshotObserver {
    return this.screenshotObserver;
  }

  public getNetworkObserver(): NetworkObserver {
    return this.networkObserver;
  }
}

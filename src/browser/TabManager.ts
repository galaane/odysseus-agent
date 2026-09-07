import type { BrowserContext, Page } from 'playwright-core';
import { BrowserEventEmitter, type TabState } from './BrowserEvents.js';
import type { BrowserState } from './BrowserState.js';
import { BrowserError, ErrorCodes } from './BrowserError.js';
import type { DownloadManager } from './DownloadManager.js';
import type { NetworkObserver } from '../observer/NetworkObserver.js';
import { Logger } from '../logging/Logger.js';

export interface TabRecord {
  id: string;
  page: Page;
  createdAt: string;
}

export class TabManager {
  private tabs = new Map<string, TabRecord>();
  private activeTabId: string | null = null;
  private tabCounter = 0;
  private context: BrowserContext | null = null;

  constructor(
    private emitter: BrowserEventEmitter,
    private logger: Logger,
    private downloadManager?: DownloadManager,
    private networkObserver?: NetworkObserver
  ) {}

  /**
   * Initializes the TabManager with an active BrowserContext.
   */
  public async init(context: BrowserContext): Promise<void> {
    this.context = context;
    this.tabs.clear();
    this.activeTabId = null;

    // Listen for pages created externally (e.g. popups or target="_blank")
    context.on('page', (page: Page) => {
      this.handleExternalPage(page).catch((err) => {
        this.logger.error('TabManager', `Failed to register external page: ${String(err)}`);
      });
    });

    // Discover any existing pages already open in the persistent context
    const existingPages = context.pages();
    if (existingPages.length > 0) {
      for (const page of existingPages) {
        await this.registerPage(page);
      }
    } else {
      // Create initial tab if context is empty
      await this.newTab();
    }
  }

  /**
   * Creates a new tab, optionally navigating to a URL.
   */
  public async newTab(url?: string): Promise<TabState> {
    if (!this.context) {
      throw new BrowserError(ErrorCodes.BROWSER_NOT_CONNECTED, 'BrowserContext is not initialized.');
    }

    const page = await this.context.newPage();
    const tabRecord = await this.registerPage(page);

    if (url) {
      try {
        await page.goto(url, { waitUntil: 'load' });
      } catch (err: unknown) {
        this.logger.warn('TabManager', `Initial navigation failed for ${url}: ${String(err)}`);
      }
    }

    await this.switchTab(tabRecord.id);
    return this.getTabState(tabRecord.id)!;
  }

  /**
   * Switches the active tab to the specified tabId.
   */
  public async switchTab(tabId: string): Promise<TabState> {
    const record = this.tabs.get(tabId);
    if (!record) {
      throw new BrowserError(ErrorCodes.ELEMENT_NOT_FOUND, `Tab with ID ${tabId} does not exist.`);
    }

    this.activeTabId = tabId;

    try {
      if (!record.page.isClosed()) {
        await record.page.bringToFront();
      }
    } catch {
      // Ignore if page does not support bringToFront
    }

    const state = this.getTabState(tabId)!;
    this.emitter.emitEvent('tab.activated', state);
    this.logger.info('TabManager', `Switched active tab to ${tabId}`, { tabId, url: state.url });
    return state;
  }

  /**
   * Closes a tab by ID.
   */
  public async closeTab(tabId: string): Promise<void> {
    const record = this.tabs.get(tabId);
    if (!record) {
      return;
    }

    this.tabs.delete(tabId);

    try {
      if (!record.page.isClosed()) {
        await record.page.close();
      }
    } catch (err: unknown) {
      this.logger.warn('TabManager', `Error closing page for tab ${tabId}: ${String(err)}`);
    }

    this.emitter.emitEvent('tab.closed', { tabId });
    this.logger.info('TabManager', `Closed tab ${tabId}`);

    // If closed tab was active, activate another remaining tab
    if (this.activeTabId === tabId) {
      const remainingIds = Array.from(this.tabs.keys());
      if (remainingIds.length > 0) {
        await this.switchTab(remainingIds[remainingIds.length - 1]);
      } else {
        this.activeTabId = null;
      }
    }
  }

  /**
   * Returns the currently active TabState or null.
   */
  public getActiveTab(): TabState | null {
    if (!this.activeTabId) return null;
    return this.getTabState(this.activeTabId);
  }

  /**
   * Returns the active Playwright Page instance.
   */
  public getActivePage(): Page {
    if (!this.activeTabId) {
      throw new BrowserError(ErrorCodes.BROWSER_NOT_CONNECTED, 'No active tab available.');
    }
    const record = this.tabs.get(this.activeTabId);
    if (!record || record.page.isClosed()) {
      throw new BrowserError(ErrorCodes.BROWSER_NOT_CONNECTED, 'Active page is closed or unavailable.');
    }
    return record.page;
  }

  /**
   * Lists all open tabs as TabState snapshots.
   */
  public listTabs(): TabState[] {
    return Array.from(this.tabs.keys())
      .map((id) => this.getTabState(id))
      .filter((tab): tab is TabState => tab !== null);
  }

  /**
   * Returns the TabState for a specific tab ID.
   */
  public getTabState(tabId: string): TabState | null {
    const record = this.tabs.get(tabId);
    if (!record || (typeof record.page.isClosed === 'function' && record.page.isClosed())) return null;

    let url = '';
    let title = '';
    try {
      url = record.page.url();
    } catch {
      url = '';
    }

    return {
      id: record.id,
      url,
      title,
      active: this.activeTabId === record.id,
      createdAt: record.createdAt,
    };
  }

  /**
   * Returns a complete queryable snapshot of the BrowserState.
   */
  public getBrowserState(): BrowserState {
    const tabs = this.listTabs();
    const activeTab = this.getActiveTab();

    return {
      connected: this.context !== null,
      currentTabId: this.activeTabId,
      tabs,
      currentUrl: activeTab ? activeTab.url : null,
      pageTitle: activeTab ? activeTab.title : null,
    };
  }

  /**
   * Resolves a Playwright Page to its stable tabId.
   */
  public getTabIdForPage(page: Page): string | undefined {
    for (const [id, record] of this.tabs.entries()) {
      if (record.page === page) {
        return id;
      }
    }
    return undefined;
  }

  /**
   * Registers an external or new Page instance.
   */
  public async registerPage(page: Page): Promise<TabRecord> {
    // Check if already registered
    const existingId = this.getTabIdForPage(page);
    if (existingId) {
      return this.tabs.get(existingId)!;
    }

    this.tabCounter += 1;
    const id = `tab_${String(this.tabCounter).padStart(3, '0')}`;
    const record: TabRecord = {
      id,
      page,
      createdAt: new Date().toISOString(),
    };

    this.tabs.set(id, record);

    // Attach download interception
    if (this.downloadManager) {
      this.downloadManager.attachToPage(page, id);
    }

    // Attach network interception
    if (this.networkObserver) {
      this.networkObserver.attachToPage(page, id);
    }

    // Attach close listener to clean up if closed externally from browser UI
    page.once('close', () => {
      if (!this.tabs.has(id)) {
        return; // Already closed and handled by closeTab()
      }
      this.tabs.delete(id);
      this.emitter.emitEvent('tab.closed', { tabId: id });
      if (this.activeTabId === id) {
        const remaining = Array.from(this.tabs.keys());
        if (remaining.length > 0) {
          this.switchTab(remaining[remaining.length - 1]).catch(() => {});
        } else {
          this.activeTabId = null;
        }
      }
    });

    // Attach frame navigation listeners
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        const url = page.url();
        this.emitter.emitEvent('navigation.completed', {
          tabId: id,
          url,
          title: '',
        });
      }
    });

    if (!this.activeTabId) {
      this.activeTabId = id;
    }

    const state = this.getTabState(id)!;
    this.emitter.emitEvent('tab.created', state);
    this.logger.info('TabManager', `Registered new tab ${id}`, { tabId: id });

    return record;
  }

  private async handleExternalPage(page: Page): Promise<void> {
    const record = await this.registerPage(page);
    await this.switchTab(record.id);
  }
}

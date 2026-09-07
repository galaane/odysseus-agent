import { launchPersistentContext } from 'cloakbrowser';
import type { BrowserContext } from 'playwright-core';
import { ActionMutex } from './ActionMutex.js';
import { BrowserError, ErrorCodes } from './BrowserError.js';
import { BrowserEventEmitter } from './BrowserEvents.js';
import { TabManager } from './TabManager.js';
import { TabBranchManager } from './TabBranchManager.js';
import { PageManager } from './PageManager.js';
import { DownloadManager } from './DownloadManager.js';
import { NetworkObserver } from '../observer/NetworkObserver.js';
import type { BrowserState } from './BrowserState.js';
import type { Config } from '../config/Config.js';
import { Logger } from '../logging/Logger.js';

export class BrowserManager {
  private static instance: BrowserManager | null = null;
  private context: BrowserContext | null = null;
  private mutex: ActionMutex = new ActionMutex();
  private emitter: BrowserEventEmitter;
  private downloadManager: DownloadManager;
  private networkObserver: NetworkObserver;
  private tabManager: TabManager;
  private tabBranchManager: TabBranchManager;
  private pageManager: PageManager;
  private isShuttingDown = false;
  private exitHookRegistered = false;

  private constructor(
    private config: Config,
    private logger: Logger
  ) {
    this.emitter = new BrowserEventEmitter();
    this.downloadManager = new DownloadManager({
      baseDownloadDir: this.config.downloadDir,
      emitter: this.emitter,
      logger: this.logger,
    });
    this.networkObserver = new NetworkObserver({ logger: this.logger });
    this.tabManager = new TabManager(this.emitter, this.logger, this.downloadManager, this.networkObserver);
    this.tabBranchManager = new TabBranchManager(this.tabManager, this.logger);
    this.pageManager = new PageManager(this.tabManager, this.emitter, this.logger);
  }

  /**
   * Returns the singleton instance of BrowserManager.
   */
  public static getInstance(config: Config, logger: Logger): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager(config, logger);
    }
    return BrowserManager.instance;
  }

  /**
   * Resets the singleton instance (strictly intended for isolated tests).
   */
  public static resetInstanceForTesting(): void {
    BrowserManager.instance = null;
  }

  /**
   * Starts the persistent CloakBrowser Chromium context.
   * Throws BrowserError if a browser context is already active.
   */
  public async start(): Promise<BrowserContext> {
    if (this.context) {
      throw new BrowserError(
        ErrorCodes.BROWSER_ALREADY_RUNNING,
        'A persistent browser session is already active. Multi-browser creation is prohibited.'
      );
    }

    this.logger.info('BrowserManager', 'Launching CloakBrowser persistent context...', {
      profilePath: this.config.browserProfilePath,
      headless: this.config.browserHeadless,
    });

    try {
      this.context = await launchPersistentContext({
        userDataDir: this.config.browserProfilePath,
        headless: this.config.browserHeadless,
        viewport: { width: 1280, height: 800 },
      });

      this.context.on('close', () => {
        this.logger.warn('BrowserManager', 'Browser context has been closed or disconnected.');
        this.context = null;
        this.emitter.emitEvent('browser.stopped');
      });

      await this.tabManager.init(this.context);
      this.emitter.emitEvent('browser.started');

      this.registerExitHooks();
      return this.context;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error('BrowserManager', `Failed to start CloakBrowser: ${message}`);
      throw new BrowserError(ErrorCodes.BROWSER_NOT_CONNECTED, `Failed to launch CloakBrowser: ${message}`);
    }
  }

  /**
   * Returns the active BrowserContext or throws if not connected.
   */
  public getContext(): BrowserContext {
    if (!this.context) {
      throw new BrowserError(
        ErrorCodes.BROWSER_NOT_CONNECTED,
        'Browser context is not initialized. Please call start() first.'
      );
    }
    return this.context;
  }

  /**
   * Executes an action with the ActionMutex acquired, guaranteeing serial browser interactions.
   */
  public async runWithLock<T>(action: (context: BrowserContext) => Promise<T>, timeoutMs?: number): Promise<T> {
    return this.mutex.runExclusive(async () => {
      if (!this.context) {
        throw new BrowserError(
          ErrorCodes.BROWSER_NOT_CONNECTED,
          'Cannot execute browser action: Browser is not connected.'
        );
      }
      return await action(this.context);
    }, timeoutMs);
  }

  /**
   * Restarts the browser context cleanly.
   */
  public async restart(): Promise<BrowserContext> {
    this.logger.info('BrowserManager', 'Restarting browser session...');
    await this.stop();
    return this.start();
  }

  /**
   * Closes the active browser context and persists profile.
   */
  public async stop(): Promise<void> {
    if (this.context) {
      this.logger.info('BrowserManager', 'Closing persistent browser context...');
      try {
        await this.context.close();
      } catch (err: unknown) {
        this.logger.warn('BrowserManager', `Error during browser context closure: ${String(err)}`);
      } finally {
        this.context = null;
        this.emitter.emitEvent('browser.stopped');
      }
    }
  }

  /**
   * Checks if the browser is currently running and healthy.
   */
  public isHealthy(): boolean {
    return this.context !== null && !this.isShuttingDown;
  }

  /**
   * Returns the ActionMutex instance.
   */
  public getMutex(): ActionMutex {
    return this.mutex;
  }

  /**
   * Returns the TabManager instance.
   */
  public getTabManager(): TabManager {
    return this.tabManager;
  }

  /**
   * Returns the TabBranchManager instance.
   */
  public getTabBranchManager(): TabBranchManager {
    return this.tabBranchManager;
  }

  /**
   * Returns the PageManager instance.
   */
  public getPageManager(): PageManager {
    return this.pageManager;
  }

  /**
   * Returns the DownloadManager instance.
   */
  public getDownloadManager(): DownloadManager {
    return this.downloadManager;
  }

  /**
   * Returns the BrowserEventEmitter instance.
   */
  public getEmitter(): BrowserEventEmitter {
    return this.emitter;
  }

  /**
   * Returns the NetworkObserver instance.
   */
  public getNetworkObserver(): NetworkObserver {
    return this.networkObserver;
  }

  /**
   * Returns a queryable snapshot of BrowserState.
   */
  public getBrowserState(): BrowserState {
    return this.tabManager.getBrowserState();
  }

  private registerExitHooks(): void {
    if (this.exitHookRegistered) return;
    this.exitHookRegistered = true;

    const cleanup = async () => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;
      this.logger.info('BrowserManager', 'Received process termination signal, closing browser...');
      await this.stop();
    };

    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
  }
}

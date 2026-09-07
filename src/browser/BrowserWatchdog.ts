import type { BrowserManager } from './BrowserManager.js';
import { BrowserError, ErrorCodes } from './BrowserError.js';
import type { Logger } from '../logging/Logger.js';

export class BrowserWatchdog {
  private isMonitoring = false;
  private unsubscribe?: () => void;

  constructor(
    private browserManager: BrowserManager,
    private logger: Logger
  ) {}

  /**
   * Begins monitoring the BrowserManager for unexpected crashes or disconnections.
   */
  public startMonitoring(): void {
    if (this.isMonitoring) return;
    this.isMonitoring = true;

    const emitter = this.browserManager.getEmitter();
    const handler = () => {
      this.logger.warn('BrowserWatchdog', 'Detected browser termination event via emitter.');
    };
    emitter.onEvent('browser.stopped', handler);
    this.unsubscribe = () => {
      emitter.off('browser.stopped', handler);
    };

    this.logger.info('BrowserWatchdog', 'Browser watchdog monitoring started.');
  }

  /**
   * Stops monitoring the BrowserManager.
   */
  public stopMonitoring(): void {
    if (!this.isMonitoring) return;
    this.isMonitoring = false;
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
  }

  /**
   * Checks whether an error represents a browser process crash or fatal connection loss.
   */
  public isCrashError(err: unknown): boolean {
    if (err instanceof BrowserError) {
      return err.code === ErrorCodes.BROWSER_CRASHED || err.code === ErrorCodes.BROWSER_NOT_CONNECTED;
    }
    const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    return (
      message.includes('target closed') ||
      message.includes('browser has been closed') ||
      message.includes('crash') ||
      message.includes('connection refused')
    );
  }

  /**
   * Automatically recovers a crashed or disconnected browser:
   * Restarts the CloakBrowser persistent context and reloads the last URL if available.
   */
  public async recoverBrowser(lastUrl?: string): Promise<boolean> {
    this.logger.warn('BrowserWatchdog', 'Initiating automatic browser process crash recovery...', { lastUrl });

    try {
      await this.browserManager.restart();

      if (lastUrl && lastUrl !== 'about:blank' && lastUrl.startsWith('http')) {
        try {
          await this.browserManager.getPageManager().navigate(lastUrl, 'domcontentloaded', 15000);
        } catch (navErr) {
          this.logger.warn('BrowserWatchdog', `Failed to restore last URL ${lastUrl}: ${String(navErr)}`);
        }
      }

      this.logger.info('BrowserWatchdog', 'Browser process successfully recovered.');
      return true;
    } catch (restartErr: unknown) {
      this.logger.error('BrowserWatchdog', `Browser crash recovery failed: ${String(restartErr)}`);
      return false;
    }
  }
}

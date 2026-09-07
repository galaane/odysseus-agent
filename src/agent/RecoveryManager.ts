import type { BrowserAction } from '../actions/Action.js';
import type { Page } from 'playwright-core';
import type { ActionResult } from '../actions/ActionResult.js';
import type { ActionExecutionContext } from '../actions/ActionExecutionContext.js';
import type { ActionRegistry } from '../actions/ActionRegistry.js';
import type { PageObserver } from '../observer/PageObserver.js';
import type { BrowserManager } from '../browser/BrowserManager.js';
import { BrowserWatchdog } from '../browser/BrowserWatchdog.js';
import { BrowserError, ErrorCodes } from '../browser/BrowserError.js';
import type { Logger } from '../logging/Logger.js';

export interface RecoveryAttemptResult {
  recovered: boolean;
  actionResult?: ActionResult;
  tierUsed?: number;
  message: string;
}

export interface FailedActionRecord {
  signature: string;
  count: number;
  lastError: string;
  timestamp: number;
}

export class RecoveryManager {
  private failedActions = new Map<string, FailedActionRecord>();
  private watchdog: BrowserWatchdog;

  constructor(
    private browserManager: BrowserManager,
    private actionRegistry: ActionRegistry,
    private pageObserver: PageObserver,
    private logger: Logger,
    watchdog?: BrowserWatchdog
  ) {
    this.watchdog = watchdog || new BrowserWatchdog(this.browserManager, this.logger);
  }

  /**
   * Generates a unique signature for an action to track repetitions.
   */
  public getActionSignature(action: BrowserAction): string {
    let target = '';
    let val = '';

    if ('targetId' in action && typeof action.targetId === 'string') target = action.targetId;
    else if ('url' in action && typeof action.url === 'string') target = action.url;
    else if ('tabId' in action && typeof action.tabId === 'string') target = action.tabId;

    if ('value' in action && typeof action.value === 'string') val = action.value;
    else if ('text' in action && typeof action.text === 'string') val = action.text;
    else if ('key' in action && typeof action.key === 'string') val = action.key;

    return `${action.type}:${target}:${val}`;
  }

  /**
   * Records whether an action succeeded or failed to detect repetitive failure loops.
   */
  public recordActionOutcome(action: BrowserAction, success: boolean, errorMessage?: string): void {
    const signature = this.getActionSignature(action);

    if (success) {
      this.failedActions.delete(signature);
      return;
    }

    const existing = this.failedActions.get(signature) || {
      signature,
      count: 0,
      lastError: '',
      timestamp: Date.now(),
    };

    existing.count++;
    existing.lastError = errorMessage || 'Unknown error';
    existing.timestamp = Date.now();
    this.failedActions.set(signature, existing);

    this.logger.warn('RecoveryManager', `Action failure recorded [${existing.count}x]: ${signature}`);
  }

  /**
   * Checks if an action is currently blocked by the loop detector (failed 3+ times).
   */
  public isActionBlocked(action: BrowserAction): boolean {
    const signature = this.getActionSignature(action);
    const record = this.failedActions.get(signature);
    return Boolean(record && record.count >= 3);
  }

  /**
   * Returns active recovery warnings to inject into the LLM prompt context.
   */
  public getPromptWarnings(): string[] {
    const warnings: string[] = [];

    for (const record of this.failedActions.values()) {
      if (record.count >= 3) {
        warnings.push(
          `[CRITICAL LOOP DETECTED] Action "${record.signature}" has failed ${record.count} consecutive times (${record.lastError}). DO NOT REPEAT THIS ACTION. Choose an alternative element, navigate elsewhere, or declare status "blocked".`
        );
      } else if (record.count >= 2) {
        warnings.push(
          `[RECOVERY NOTICE] Action "${record.signature}" failed ${record.count} times. The target element may be stale, hidden, or obstructed. Consider refreshing or choosing an alternative element.`
        );
      }
    }

    return warnings;
  }

  /**
   * Executes the multi-tier recovery ladder when an action encounters an error.
   */
  public async attemptRecovery(
    action: BrowserAction,
    context: ActionExecutionContext,
    error: unknown
  ): Promise<RecoveryAttemptResult> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCode = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as Record<string, unknown>).code)
      : ErrorCodes.UNKNOWN_ERROR;

    this.logger.warn('RecoveryManager', `Starting recovery for action ${action.type} (Error: ${errorCode} - ${errorMessage})`);

    // Tier 5: Process Crash Recovery
    if (this.watchdog.isCrashError(error)) {
      this.logger.warn('RecoveryManager', 'Escalating to Tier 5: Browser Process Crash Recovery');
      const lastUrl = context.page?.url?.() || undefined;
      const recovered = await this.watchdog.recoverBrowser(lastUrl);

      if (recovered) {
        // Re-acquire fresh active page
        const newPage = this.browserManager.getPageManager().getActivePage();
        const newTabId = this.browserManager.getTabManager().getActiveTab()?.id || 'tab_001';
        context.page = newPage;
        context.tabId = newTabId;

        // Re-observe and retry
        await this.pageObserver.observePage(newPage, newTabId);
        try {
          const retriedResult = await this.actionRegistry.dispatch(action, context);
          if (retriedResult.success) {
            this.recordActionOutcome(action, true);
            return {
              recovered: true,
              actionResult: retriedResult,
              tierUsed: 5,
              message: 'Recovered via Tier 5 (Browser restart & reconnect).',
            };
          }
        } catch {
          // Continue to next tier or exit
        }
      }
    }

    // Tier 2: DOM Re-Observation on Stale / Missing Element
    if (
      errorCode === ErrorCodes.STALE_ELEMENT ||
      errorCode === ErrorCodes.ELEMENT_NOT_FOUND ||
      errorMessage.toLowerCase().includes('stale') ||
      errorMessage.toLowerCase().includes('detached') ||
      errorMessage.toLowerCase().includes('not found')
    ) {
      this.logger.info('RecoveryManager', 'Executing Tier 2: DOM Re-Observation & Element Re-Identification');
      try {
        const activeTabId = context.tabId || 'tab_001';
        await this.pageObserver.observePage(context.page, activeTabId);

        // Re-attempt action after fresh observation
        const retriedResult = await this.actionRegistry.dispatch(action, context);
        if (retriedResult.success) {
          this.recordActionOutcome(action, true);
          return {
            recovered: true,
            actionResult: retriedResult,
            tierUsed: 2,
            message: 'Recovered via Tier 2 (DOM Re-Observation).',
          };
        }
      } catch (tier2Err) {
        this.logger.debug('RecoveryManager', `Tier 2 retry unsuccessful: ${String(tier2Err)}`);
      }
    }

    // Tier 3: Obstruction Clearance (Cookie banners, modals, scroll into view)
    if (
      errorCode === ErrorCodes.ELEMENT_NOT_INTERACTABLE ||
      errorCode === ErrorCodes.ELEMENT_NOT_VISIBLE ||
      errorMessage.toLowerCase().includes('intercepts pointer events') ||
      errorMessage.toLowerCase().includes('not visible')
    ) {
      this.logger.info('RecoveryManager', 'Executing Tier 3: Obstruction Clearance & Overlay Dismissal');
      try {
        await this.clearCommonObstructions(context.page);

        // Try scrolling target element into center
        const targetId = 'targetId' in action && typeof action.targetId === 'string'
          ? action.targetId
          : undefined;
        if (targetId && context.elementResolver) {
          try {
            const locator = context.elementResolver.resolveLocator(targetId, context.page);
            await locator.scrollIntoViewIfNeeded({ timeout: 2000 });
          } catch {
            // Ignore scroll errors
          }
        }

        const retriedResult = await this.actionRegistry.dispatch(action, context);
        if (retriedResult.success) {
          this.recordActionOutcome(action, true);
          return {
            recovered: true,
            actionResult: retriedResult,
            tierUsed: 3,
            message: 'Recovered via Tier 3 (Obstruction Clearance).',
          };
        }
      } catch (tier3Err) {
        this.logger.debug('RecoveryManager', `Tier 3 retry unsuccessful: ${String(tier3Err)}`);
      }
    }

    // Tier 1: Transient Retry with Backoff
    if (
      errorCode === ErrorCodes.ACTION_TIMEOUT ||
      errorCode === ErrorCodes.PAGE_TIMEOUT ||
      errorCode === ErrorCodes.NAVIGATION_TIMEOUT
    ) {
      this.logger.info('RecoveryManager', 'Executing Tier 1: Transient Retry with Backoff');
      try {
        await new Promise((res) => setTimeout(res, 1000));
        const retriedResult = await this.actionRegistry.dispatch(action, context);
        if (retriedResult.success) {
          this.recordActionOutcome(action, true);
          return {
            recovered: true,
            actionResult: retriedResult,
            tierUsed: 1,
            message: 'Recovered via Tier 1 (Transient retry).',
          };
        }
      } catch (tier1Err) {
        this.logger.debug('RecoveryManager', `Tier 1 retry unsuccessful: ${String(tier1Err)}`);
      }
    }

    // Unrecoverable at local tiers -> escalate to Tier 4 / Tier 6
    this.recordActionOutcome(action, false, errorMessage);

    return {
      recovered: false,
      tierUsed: this.isActionBlocked(action) ? 6 : 4,
      message: `Action recovery failed: ${errorMessage}. Escalated to Tier ${this.isActionBlocked(action) ? 6 : 4}.`,
    };
  }

  /**
   * Attempts to auto-dismiss common modal obstructions and cookie consent dialogs.
   */
  private async clearCommonObstructions(page: Page): Promise<void> {
    if (!page || typeof page.locator !== 'function') return;

    const commonDismissSelectors = [
      '#onetrust-accept-btn-handler',
      'button#accept-cookies',
      'button:has-text("Accept all")',
      'button:has-text("Accept All Cookies")',
      'button:has-text("I agree")',
      'button:has-text("Got it")',
      'button[aria-label="Close"]',
      'button.close',
      '.modal-close',
      '[data-dismiss="modal"]',
    ];

    for (const selector of commonDismissSelectors) {
      try {
        const btn = page.locator(selector).first();
        const count = await btn.count().catch(() => 0);
        if (count > 0 && (await btn.isVisible().catch(() => false))) {
          this.logger.info('RecoveryManager', `Dismissing obstruction overlay matching selector: ${selector}`);
          await btn.click({ timeout: 1500 });
          await new Promise((res) => setTimeout(res, 300));
          break;
        }
      } catch {
        // Continue checking other candidates
      }
    }
  }

  public getWatchdog(): BrowserWatchdog {
    return this.watchdog;
  }

  public clear(): void {
    this.failedActions.clear();
  }
}

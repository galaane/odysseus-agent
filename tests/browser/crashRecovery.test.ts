import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page, BrowserContext } from 'playwright-core';
import { BrowserWatchdog } from '../../src/browser/BrowserWatchdog.js';
import { BrowserManager } from '../../src/browser/BrowserManager.js';
import { RecoveryManager } from '../../src/agent/RecoveryManager.js';
import { ActionRegistry } from '../../src/actions/ActionRegistry.js';
import { PageObserver } from '../../src/observer/PageObserver.js';
import { BrowserError, ErrorCodes } from '../../src/browser/BrowserError.js';
import { Logger } from '../../src/logging/Logger.js';
import { loadConfig } from '../../src/config/Config.js';
import type { NavigateAction } from '../../src/actions/Action.js';
import type { ActionExecutionContext } from '../../src/actions/ActionExecutionContext.js';

describe('Crash Recovery & Watchdog Subsystem (Tier 5)', () => {
  let logger: Logger;
  let browserManager: BrowserManager;
  let watchdog: BrowserWatchdog;
  let actionRegistry: ActionRegistry;
  let pageObserver: PageObserver;
  let recoveryManager: RecoveryManager;
  let mockPage: Page;

  beforeEach(async () => {
    logger = new Logger('debug', () => {});
    const config = loadConfig({ BROWSER_HEADLESS: 'true' });

    BrowserManager.resetInstanceForTesting();
    browserManager = BrowserManager.getInstance(config, logger);

    mockPage = {
      url: vi.fn(() => 'https://example.com/portal'),
      title: vi.fn(async () => 'Portal Page'),
      isClosed: vi.fn(() => false),
      goto: vi.fn(async () => {}),
      evaluate: vi.fn().mockResolvedValue([]),
      on: vi.fn(() => mockPage),
      once: vi.fn(() => mockPage),
    } as unknown as Page;

    const mockContext = {
      pages: vi.fn(() => [mockPage]),
      newPage: vi.fn(async () => mockPage),
      on: vi.fn(() => mockContext),
      close: vi.fn(async () => {}),
    } as unknown as BrowserContext;

    await browserManager.getTabManager().init(mockContext);

    watchdog = new BrowserWatchdog(browserManager, logger);
    actionRegistry = new ActionRegistry();
    pageObserver = new PageObserver();
    recoveryManager = new RecoveryManager(browserManager, actionRegistry, pageObserver, logger, watchdog);
  });

  it('should identify fatal browser crash errors accurately', () => {
    expect(watchdog.isCrashError(new BrowserError(ErrorCodes.BROWSER_CRASHED, 'Crash'))).toBe(true);
    expect(watchdog.isCrashError(new BrowserError(ErrorCodes.BROWSER_NOT_CONNECTED, 'Disconnected'))).toBe(true);
    expect(watchdog.isCrashError(new Error('Target closed while waiting'))).toBe(true);
    expect(watchdog.isCrashError(new Error('Page.click: browser has been closed'))).toBe(true);

    // Non-crash errors
    expect(watchdog.isCrashError(new BrowserError(ErrorCodes.ELEMENT_NOT_FOUND, 'Missing'))).toBe(false);
    expect(watchdog.isCrashError(new Error('Timeout 5000ms exceeded'))).toBe(false);
  });

  it('should restart CloakBrowser and restore last active URL on recoverBrowser', async () => {
    const restartSpy = vi.spyOn(browserManager, 'restart').mockResolvedValue({} as any);
    const navigateSpy = vi.spyOn(browserManager.getPageManager(), 'navigate').mockResolvedValue();

    const recovered = await watchdog.recoverBrowser('https://example.com/portal');

    expect(recovered).toBe(true);
    expect(restartSpy).toHaveBeenCalled();
    expect(navigateSpy).toHaveBeenCalledWith('https://example.com/portal', 'domcontentloaded', 15000);
  });

  it('should escalate to Tier 5 recovery and successfully recover from crash during action execution', async () => {
    vi.spyOn(watchdog, 'recoverBrowser').mockResolvedValue(true);
    vi.spyOn(pageObserver, 'observePage').mockResolvedValue({
      timestamp: new Date().toISOString(),
      url: 'https://example.com/portal',
      title: 'Portal',
      activeTabId: 'tab_001',
      interactiveElements: [],
      pageSummary: { headings: [], forms: [], links: [] },
      compressedObservationText: '',
    });

    let dispatchCount = 0;
    vi.spyOn(actionRegistry, 'dispatch').mockImplementation(async () => {
      dispatchCount++;
      return {
        actionId: 'act_nav_1',
        actionType: 'navigate',
        success: true,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 10,
      };
    });

    const action: NavigateAction = {
      id: 'act_nav_1',
      type: 'navigate',
      url: 'https://example.com/portal',
      waitUntil: 'load',
    };

    const context: ActionExecutionContext = {
      page: mockPage,
      tabId: 'tab_001',
      browserManager,
      logger,
      elementResolver: pageObserver.getRegistry(),
    };

    const crashError = new BrowserError(ErrorCodes.BROWSER_CRASHED, 'Chromium process crashed unexpectedly');

    const outcome = await recoveryManager.attemptRecovery(action, context, crashError);

    expect(outcome.recovered).toBe(true);
    expect(outcome.tierUsed).toBe(5);
    expect(dispatchCount).toBe(1);
    expect(watchdog.recoverBrowser).toHaveBeenCalledWith('https://example.com/portal');
  });
});

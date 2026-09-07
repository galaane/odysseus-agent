import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page } from 'playwright-core';
import { ActionRegistry } from '../../src/actions/ActionRegistry.js';
import type { ActionExecutionContext } from '../../src/actions/ActionExecutionContext.js';
import { BrowserManager } from '../../src/browser/BrowserManager.js';
import { BrowserError, ErrorCodes } from '../../src/browser/BrowserError.js';
import { loadConfig } from '../../src/config/Config.js';
import { Logger } from '../../src/logging/Logger.js';

describe('ActionRegistry Dispatcher', () => {
  let logger: Logger;
  let browserManager: BrowserManager;
  let registry: ActionRegistry;
  let mockPage: Page;
  let context: ActionExecutionContext;

  beforeEach(() => {
    logger = new Logger('debug', () => {});
    const config = loadConfig({ BROWSER_HEADLESS: 'true' });
    BrowserManager.resetInstanceForTesting();
    browserManager = BrowserManager.getInstance(config, logger);

    // Mock runWithLock to execute callback directly
    vi.spyOn(browserManager, 'runWithLock').mockImplementation(async (cb: any) => {
      return await cb({} as any);
    });

    mockPage = {
      goto: vi.fn(async () => {}),
      url: vi.fn(() => 'https://example.com/dest'),
      title: vi.fn(async () => 'Example Title'),
    } as unknown as Page;

    context = {
      page: mockPage,
      tabId: 'tab_001',
      browserManager,
      logger,
    };

    registry = new ActionRegistry();
  });

  it('should dispatch navigate action, acquire mutex, and return successful ActionResult', async () => {
    const result = await registry.dispatch(
      { id: 'act_101', type: 'navigate', url: 'https://example.com/dest', waitUntil: 'load' },
      context
    );

    expect(browserManager.runWithLock).toHaveBeenCalled();
    expect(result.actionId).toBe('act_101');
    expect(result.actionType).toBe('navigate');
    expect(result.success).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.startedAt).toBeDefined();
    expect(result.finishedAt).toBeDefined();
    expect(result.observationDelta).toEqual({
      url: 'https://example.com/dest',
      title: 'Example Title',
    });
  });

  it('should capture thrown BrowserError and return failed ActionResult with error code', async () => {
    mockPage.goto = vi.fn().mockRejectedValue(
      new BrowserError(ErrorCodes.NAVIGATION_TIMEOUT, 'Navigation timed out')
    );

    const result = await registry.dispatch(
      { id: 'act_102', type: 'navigate', url: 'https://slow-site.com', waitUntil: 'networkidle' },
      context
    );

    expect(result.actionId).toBe('act_102');
    expect(result.actionType).toBe('navigate');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe(ErrorCodes.NAVIGATION_TIMEOUT);
    expect(result.error?.message).toContain('Navigation timed out');
  });

  it('should measure execution duration accurately', async () => {
    mockPage.goto = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    const result = await registry.dispatch(
      { id: 'act_103', type: 'navigate', url: 'https://example.com', waitUntil: 'load' },
      context
    );

    expect(result.durationMs).toBeGreaterThanOrEqual(25);
  });
});

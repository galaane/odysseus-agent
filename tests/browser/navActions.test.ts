import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page, BrowserContext } from 'playwright-core';
import { NavigateHandler } from '../../src/actions/handlers/NavigateHandler.js';
import { WaitHandler } from '../../src/actions/handlers/WaitHandler.js';
import { TabActionsHandler } from '../../src/actions/handlers/TabActionsHandler.js';
import type { ActionExecutionContext } from '../../src/actions/ActionExecutionContext.js';
import { BrowserManager } from '../../src/browser/BrowserManager.js';
import { loadConfig } from '../../src/config/Config.js';
import { Logger } from '../../src/logging/Logger.js';

describe('Navigation & Tab Action Handlers', () => {
  let logger: Logger;
  let mockPage: Page;
  let browserManager: BrowserManager;
  let context: ActionExecutionContext;

  beforeEach(() => {
    logger = new Logger('debug', () => {});
    const config = loadConfig({ BROWSER_HEADLESS: 'true' });
    BrowserManager.resetInstanceForTesting();
    browserManager = BrowserManager.getInstance(config, logger);

    mockPage = {
      url: vi.fn(() => 'https://example.com/dashboard'),
      title: vi.fn(async () => 'Dashboard Title'),
      goto: vi.fn(async () => {}),
      waitForTimeout: vi.fn(async () => {}),
      waitForLoadState: vi.fn(async () => {}),
      waitForSelector: vi.fn(async () => {}),
    } as unknown as Page;

    context = {
      page: mockPage,
      tabId: 'tab_001',
      browserManager,
      logger,
    };
  });

  describe('NavigateHandler', () => {
    it('should navigate to URL and return observationDelta', async () => {
      const handler = new NavigateHandler();
      const result = await handler.execute(
        { id: 'act_1', type: 'navigate', url: 'https://example.com/test', waitUntil: 'networkidle' },
        context
      );

      expect(mockPage.goto).toHaveBeenCalledWith('https://example.com/test', {
        waitUntil: 'networkidle',
        timeout: undefined,
      });
      expect(result.observationDelta).toEqual({
        url: 'https://example.com/dashboard',
        title: 'Dashboard Title',
      });
    });
  });

  describe('WaitHandler', () => {
    it('should wait for timeout condition', async () => {
      const handler = new WaitHandler();
      const result = await handler.execute(
        { id: 'act_2', type: 'wait', condition: 'timeout', timeoutMs: 1500 },
        context
      );

      expect(mockPage.waitForTimeout).toHaveBeenCalledWith(1500);
      expect(result.observationDelta).toEqual({ waitedCondition: 'timeout' });
    });

    it('should wait for network-idle condition', async () => {
      const handler = new WaitHandler();
      await handler.execute(
        { id: 'act_3', type: 'wait', condition: 'network-idle', timeoutMs: 4000 },
        context
      );

      expect(mockPage.waitForLoadState).toHaveBeenCalledWith('networkidle', { timeout: 4000 });
    });

    it('should wait for selector condition', async () => {
      const handler = new WaitHandler();
      await handler.execute(
        { id: 'act_4', type: 'wait', condition: 'selector', selector: '#main-content', timeoutMs: 3000 },
        context
      );

      expect(mockPage.waitForSelector).toHaveBeenCalledWith('#main-content', { timeout: 3000 });
    });
  });

  describe('TabActionsHandler', () => {
    it('should coordinate new_tab, switch_tab, and close_tab with TabManager', async () => {
      const tabManager = browserManager.getTabManager();
      vi.spyOn(tabManager, 'newTab').mockResolvedValue({
        id: 'tab_002',
        url: 'https://newtab.org',
        title: 'New Tab',
        active: true,
        createdAt: new Date().toISOString(),
      });
      vi.spyOn(tabManager, 'switchTab').mockResolvedValue({
        id: 'tab_001',
        url: 'https://initial.org',
        title: 'Initial Tab',
        active: true,
        createdAt: new Date().toISOString(),
      });
      vi.spyOn(tabManager, 'closeTab').mockResolvedValue();

      const handler = new TabActionsHandler();

      const newTabRes = await handler.handleNewTab(
        { id: 'act_5', type: 'new_tab', url: 'https://newtab.org' },
        context
      );
      expect(newTabRes.observationDelta).toEqual({
        createdTabId: 'tab_002',
        url: 'https://newtab.org',
      });

      const switchRes = await handler.handleSwitchTab(
        { id: 'act_6', type: 'switch_tab', tabId: 'tab_001' },
        context
      );
      expect(switchRes.observationDelta).toEqual({
        activeTabId: 'tab_001',
        url: 'https://initial.org',
      });

      const closeRes = await handler.handleCloseTab(
        { id: 'act_7', type: 'close_tab', tabId: 'tab_002' },
        context
      );
      expect(closeRes.observationDelta).toBeDefined();
    });
  });
});

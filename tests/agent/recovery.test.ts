import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page, BrowserContext } from 'playwright-core';
import { RecoveryManager } from '../../src/agent/RecoveryManager.js';
import { BrowserManager } from '../../src/browser/BrowserManager.js';
import { ActionRegistry } from '../../src/actions/ActionRegistry.js';
import { PageObserver } from '../../src/observer/PageObserver.js';
import { BrowserError, ErrorCodes } from '../../src/browser/BrowserError.js';
import { Logger } from '../../src/logging/Logger.js';
import { loadConfig } from '../../src/config/Config.js';
import type { ClickAction } from '../../src/actions/Action.js';
import type { ActionExecutionContext } from '../../src/actions/ActionExecutionContext.js';

describe('RecoveryManager Subsystem (Recovery Ladder & Loop Detection)', () => {
  let logger: Logger;
  let browserManager: BrowserManager;
  let actionRegistry: ActionRegistry;
  let pageObserver: PageObserver;
  let recoveryManager: RecoveryManager;
  let mockPage: Page;
  let context: ActionExecutionContext;

  const sampleClickAction: ClickAction = {
    id: 'act_click_1',
    type: 'click',
    targetId: 'el_002',
  };

  beforeEach(async () => {
    logger = new Logger('debug', () => {});
    const config = loadConfig({ BROWSER_HEADLESS: 'true' });

    BrowserManager.resetInstanceForTesting();
    browserManager = BrowserManager.getInstance(config, logger);

    mockPage = {
      url: vi.fn(() => 'https://example.com/checkout'),
      title: vi.fn(async () => 'Checkout'),
      isClosed: vi.fn(() => false),
      evaluate: vi.fn().mockResolvedValue([]),
      locator: vi.fn(() => ({
        first: vi.fn(() => ({
          count: vi.fn(async () => 1),
          isVisible: vi.fn(async () => true),
          click: vi.fn(async () => {}),
        })),
        scrollIntoViewIfNeeded: vi.fn(async () => {}),
      })),
      on: vi.fn(() => mockPage),
      once: vi.fn(() => mockPage),
    } as unknown as Page;

    const mockContext = {
      pages: vi.fn(() => [mockPage]),
      newPage: vi.fn(async () => mockPage),
      on: vi.fn(() => mockContext),
    } as unknown as BrowserContext;

    await browserManager.getTabManager().init(mockContext);

    actionRegistry = new ActionRegistry();
    pageObserver = new PageObserver();
    recoveryManager = new RecoveryManager(browserManager, actionRegistry, pageObserver, logger);

    context = {
      page: mockPage,
      tabId: 'tab_001',
      browserManager,
      logger,
      elementResolver: pageObserver.getRegistry(),
    };
  });

  describe('Tier 2: DOM Re-Observation (Stale / Detached Element)', () => {
    it('should re-observe page and successfully retry action on stale element error', async () => {
      let attempts = 0;
      vi.spyOn(actionRegistry, 'dispatch').mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          return {
            actionId: 'act_click_1',
            actionType: 'click',
            success: false,
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            durationMs: 10,
            error: {
              code: ErrorCodes.STALE_ELEMENT,
              message: 'Element handle is detached from document',
            },
          };
        }
        return {
          actionId: 'act_click_1',
          actionType: 'click',
          success: true,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 10,
        };
      });

      const observeSpy = vi.spyOn(pageObserver, 'observePage');

      // Initial execution attempt fails
      await actionRegistry.dispatch(sampleClickAction, context);

      const recovery = await recoveryManager.attemptRecovery(
        sampleClickAction,
        context,
        new BrowserError(ErrorCodes.STALE_ELEMENT, 'Element is detached')
      );

      expect(recovery.recovered).toBe(true);
      expect(recovery.tierUsed).toBe(2);
      expect(observeSpy).toHaveBeenCalled();
      expect(attempts).toBe(2);
    });
  });

  describe('Tier 3: Obstruction Clearance (Cookie Banners / Overlays)', () => {
    it('should dismiss blocking modal and successfully retry action on element not interactable', async () => {
      let attempts = 0;
      vi.spyOn(actionRegistry, 'dispatch').mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          return {
            actionId: 'act_click_1',
            actionType: 'click',
            success: false,
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            durationMs: 10,
            error: {
              code: ErrorCodes.ELEMENT_NOT_INTERACTABLE,
              message: 'Element intercepts pointer events',
            },
          };
        }
        return {
          actionId: 'act_click_1',
          actionType: 'click',
          success: true,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 10,
        };
      });

      // Initial execution attempt fails
      await actionRegistry.dispatch(sampleClickAction, context);

      const recovery = await recoveryManager.attemptRecovery(
        sampleClickAction,
        context,
        new BrowserError(ErrorCodes.ELEMENT_NOT_INTERACTABLE, 'Element is obstructed by cookie banner')
      );

      expect(recovery.recovered).toBe(true);
      expect(recovery.tierUsed).toBe(3);
      expect(attempts).toBe(2);
    });
  });

  describe('Tier 1: Transient Retry with Backoff', () => {
    it('should retry transient timeout error and succeed', async () => {
      let attempts = 0;
      vi.spyOn(actionRegistry, 'dispatch').mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          return {
            actionId: 'act_click_1',
            actionType: 'click',
            success: false,
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            durationMs: 10,
            error: {
              code: ErrorCodes.ACTION_TIMEOUT,
              message: 'Action timed out',
            },
          };
        }
        return {
          actionId: 'act_click_1',
          actionType: 'click',
          success: true,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 10,
        };
      });

      // Initial execution attempt fails
      await actionRegistry.dispatch(sampleClickAction, context);

      const recovery = await recoveryManager.attemptRecovery(
        sampleClickAction,
        context,
        new BrowserError(ErrorCodes.ACTION_TIMEOUT, 'Action timed out')
      );

      expect(recovery.recovered).toBe(true);
      expect(recovery.tierUsed).toBe(1);
      expect(attempts).toBe(2);
    });
  });

  describe('Repetitive Action Loop Detector', () => {
    it('should track action failures and enforce loop blocker on 3 consecutive failures', () => {
      expect(recoveryManager.isActionBlocked(sampleClickAction)).toBe(false);

      // Failure 1
      recoveryManager.recordActionOutcome(sampleClickAction, false, 'First timeout');
      expect(recoveryManager.isActionBlocked(sampleClickAction)).toBe(false);
      expect(recoveryManager.getPromptWarnings()).toHaveLength(0);

      // Failure 2
      recoveryManager.recordActionOutcome(sampleClickAction, false, 'Second timeout');
      expect(recoveryManager.isActionBlocked(sampleClickAction)).toBe(false);
      const warnings2 = recoveryManager.getPromptWarnings();
      expect(warnings2).toHaveLength(1);
      expect(warnings2[0]).toContain('[RECOVERY NOTICE]');

      // Failure 3 -> Blocked!
      recoveryManager.recordActionOutcome(sampleClickAction, false, 'Third timeout');
      expect(recoveryManager.isActionBlocked(sampleClickAction)).toBe(true);
      const warnings3 = recoveryManager.getPromptWarnings();
      expect(warnings3).toHaveLength(1);
      expect(warnings3[0]).toContain('[CRITICAL LOOP DETECTED]');
      expect(warnings3[0]).toContain('DO NOT REPEAT THIS ACTION');

      // Success clears the record
      recoveryManager.recordActionOutcome(sampleClickAction, true);
      expect(recoveryManager.isActionBlocked(sampleClickAction)).toBe(false);
      expect(recoveryManager.getPromptWarnings()).toHaveLength(0);
    });
  });
});

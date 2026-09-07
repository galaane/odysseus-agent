import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page, Locator } from 'playwright-core';
import { ClickHandler } from '../../src/actions/handlers/ClickHandler.js';
import { InputHandler } from '../../src/actions/handlers/InputHandler.js';
import { ScrollHandler } from '../../src/actions/handlers/ScrollHandler.js';
import { ScreenshotHandler } from '../../src/actions/handlers/ScreenshotHandler.js';
import { ExtractHandler } from '../../src/actions/handlers/ExtractHandler.js';
import type { ActionExecutionContext } from '../../src/actions/ActionExecutionContext.js';
import { BrowserManager } from '../../src/browser/BrowserManager.js';
import { loadConfig } from '../../src/config/Config.js';
import { Logger } from '../../src/logging/Logger.js';

describe('Input, Scroll, Screenshot & Extract Handlers', () => {
  let logger: Logger;
  let mockLocator: Locator;
  let mockPage: Page;
  let browserManager: BrowserManager;
  let context: ActionExecutionContext;

  beforeEach(() => {
    logger = new Logger('debug', () => {});
    const config = loadConfig({ BROWSER_HEADLESS: 'true' });
    BrowserManager.resetInstanceForTesting();
    browserManager = BrowserManager.getInstance(config, logger);

    mockLocator = {
      scrollIntoViewIfNeeded: vi.fn(async () => {}),
      click: vi.fn(async () => {}),
      fill: vi.fn(async () => {}),
      pressSequentially: vi.fn(async () => {}),
      press: vi.fn(async () => {}),
      innerText: vi.fn(async () => 'Sample Extracted Text'),
      textContent: vi.fn(async () => 'Sample Extracted Text'),
    } as unknown as Locator;

    mockPage = {
      url: vi.fn(() => 'https://example.com/app'),
      locator: vi.fn(() => mockLocator),
      mouse: {
        wheel: vi.fn(async () => {}),
      },
      keyboard: {
        press: vi.fn(async () => {}),
      },
      screenshot: vi.fn(async () => Buffer.from('fake-png-bytes')),
    } as unknown as Page;

    context = {
      page: mockPage,
      tabId: 'tab_001',
      browserManager,
      logger,
      elementResolver: {
        resolveLocator: vi.fn(() => mockLocator),
      },
    };
  });

  describe('ClickHandler', () => {
    it('should resolve element, scroll into view, and click', async () => {
      const handler = new ClickHandler();
      const result = await handler.execute(
        { id: 'act_10', type: 'click', targetId: 'el_001' },
        context
      );

      expect(context.elementResolver?.resolveLocator).toHaveBeenCalledWith('el_001', mockPage);
      expect(mockLocator.scrollIntoViewIfNeeded).toHaveBeenCalled();
      expect(mockLocator.click).toHaveBeenCalled();
      expect(result.observationDelta).toEqual({
        clickedTargetId: 'el_001',
        urlAfterClick: 'https://example.com/app',
      });
    });
  });

  describe('InputHandler', () => {
    it('should fill form input', async () => {
      const handler = new InputHandler();
      const result = await handler.handleFill(
        { id: 'act_11', type: 'fill', targetId: 'el_002', value: 'hello@agent.com' },
        context
      );

      expect(mockLocator.fill).toHaveBeenCalledWith('hello@agent.com', { timeout: 10000 });
      expect(result.observationDelta).toEqual({
        targetId: 'el_002',
        filledLength: 'hello@agent.com'.length,
      });
    });

    it('should type text sequentially with delay', async () => {
      const handler = new InputHandler();
      const result = await handler.handleType(
        { id: 'act_12', type: 'type', targetId: 'el_003', text: 'my password', delayMs: 40 },
        context
      );

      expect(mockLocator.pressSequentially).toHaveBeenCalledWith('my password', {
        delay: 40,
        timeout: 15000,
      });
      expect(result.observationDelta).toEqual({
        targetId: 'el_003',
        typedLength: 'my password'.length,
      });
    });

    it('should press key on target element or keyboard', async () => {
      const handler = new InputHandler();

      // With targetId
      await handler.handlePress(
        { id: 'act_13', type: 'press', targetId: 'el_004', key: 'Enter' },
        context
      );
      expect(mockLocator.press).toHaveBeenCalledWith('Enter');

      // Without targetId (page keyboard)
      await handler.handlePress(
        { id: 'act_14', type: 'press', key: 'Escape' },
        context
      );
      expect(mockPage.keyboard.press).toHaveBeenCalledWith('Escape');
    });
  });

  describe('ScrollHandler', () => {
    it('should scroll down and up via mouse wheel', async () => {
      const handler = new ScrollHandler();

      await handler.execute(
        { id: 'act_15', type: 'scroll', direction: 'down', amount: 600 },
        context
      );
      expect(mockPage.mouse.wheel).toHaveBeenCalledWith(0, 600);

      await handler.execute(
        { id: 'act_16', type: 'scroll', direction: 'up', amount: 300 },
        context
      );
      expect(mockPage.mouse.wheel).toHaveBeenCalledWith(0, -300);
    });
  });

  describe('ScreenshotHandler', () => {
    it('should capture screenshot and return buffer metadata', async () => {
      const handler = new ScreenshotHandler();
      const result = await handler.execute(
        { id: 'act_17', type: 'screenshot', fullPage: true },
        context
      );

      expect(mockPage.screenshot).toHaveBeenCalledWith({ fullPage: true, path: undefined });
      expect(result.observationDelta).toEqual({
        screenshotTaken: true,
        screenshotPath: undefined,
        sizeBytes: 14,
      });
    });
  });

  describe('ExtractHandler', () => {
    it('should extract text from target element', async () => {
      const handler = new ExtractHandler();
      const result = await handler.execute(
        { id: 'act_18', type: 'extract', targetId: 'el_005', instruction: 'Get text' },
        context
      );

      expect(mockLocator.innerText).toHaveBeenCalled();
      expect(result.observationDelta).toEqual({
        extractedText: 'Sample Extracted Text',
        targetId: 'el_005',
      });
    });
  });
});

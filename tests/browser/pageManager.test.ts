import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BrowserContext, Page, Dialog } from 'playwright-core';
import { PageManager } from '../../src/browser/PageManager.js';
import { TabManager } from '../../src/browser/TabManager.js';
import { BrowserEventEmitter } from '../../src/browser/BrowserEvents.js';
import { BrowserError, ErrorCodes } from '../../src/browser/BrowserError.js';
import { Logger } from '../../src/logging/Logger.js';

describe('PageManager Subsystem', () => {
  let emitter: BrowserEventEmitter;
  let logger: Logger;
  let tabManager: TabManager;
  let pageManager: PageManager;

  beforeEach(() => {
    emitter = new BrowserEventEmitter();
    logger = new Logger('debug', () => {});
    tabManager = new TabManager(emitter, logger);
    pageManager = new PageManager(tabManager, emitter, logger);
  });

  function createMockEnvironment(initialUrl = 'https://example.com') {
    let currentUrl = initialUrl;
    const pageListeners: Record<string, Function[]> = {};

    const mockPage = {
      url: vi.fn(() => currentUrl),
      title: vi.fn(async () => 'Example Domain'),
      isClosed: vi.fn(() => false),
      bringToFront: vi.fn(async () => {}),
      goto: vi.fn(async (url: string) => {
        currentUrl = url;
      }),
      close: vi.fn(async () => {}),
      on: vi.fn((event: string, handler: Function) => {
        pageListeners[event] = pageListeners[event] || [];
        pageListeners[event].push(handler);
        return mockPage;
      }),
      once: vi.fn((event: string, handler: Function) => {
        pageListeners[event] = pageListeners[event] || [];
        pageListeners[event].push(handler);
        return mockPage;
      }),
      frames: vi.fn(() => [{ name: () => 'main' }]),
      mainFrame: vi.fn(() => ({})),
    } as unknown as Page;

    const mockContext = {
      pages: vi.fn(() => [mockPage]),
      newPage: vi.fn(async () => mockPage),
      on: vi.fn(() => mockContext),
    } as unknown as BrowserContext;

    return { mockPage, mockContext, pageListeners };
  }

  it('should auto-dismiss native dialogs by default and emit dialog.opened', async () => {
    const { mockPage, mockContext, pageListeners } = createMockEnvironment();
    await tabManager.init(mockContext);

    // Call getActivePage() which attaches the dialog handler
    pageManager.getActivePage();

    const dialogEvents: any[] = [];
    emitter.onEvent('dialog.opened', (data) => dialogEvents.push(data));

    const mockDialog = {
      type: () => 'alert',
      message: () => 'System update available',
      defaultValue: () => '',
      dismiss: vi.fn(async () => {}),
      accept: vi.fn(async () => {}),
    } as unknown as Dialog;

    // Simulate dialog event from Playwright
    expect(pageListeners['dialog']).toBeDefined();
    await pageListeners['dialog'][0](mockDialog);

    expect(dialogEvents).toHaveLength(1);
    expect(dialogEvents[0].message).toBe('System update available');
    expect(dialogEvents[0].type).toBe('alert');
    expect(mockDialog.dismiss).toHaveBeenCalledTimes(1);
    expect(mockDialog.accept).not.toHaveBeenCalled();
  });

  it('should accept dialogs when policy is configured to accept', async () => {
    const { mockPage, mockContext, pageListeners } = createMockEnvironment();
    await tabManager.init(mockContext);

    pageManager.setDialogPolicy('accept', 'userInput');
    pageManager.getActivePage();

    const mockDialog = {
      type: () => 'prompt',
      message: () => 'Enter your username',
      defaultValue: () => 'guest',
      dismiss: vi.fn(async () => {}),
      accept: vi.fn(async () => {}),
    } as unknown as Dialog;

    await pageListeners['dialog'][0](mockDialog);

    expect(mockDialog.accept).toHaveBeenCalledWith('userInput');
    expect(mockDialog.dismiss).not.toHaveBeenCalled();
  });

  it('should navigate and emit navigation events', async () => {
    const { mockPage, mockContext } = createMockEnvironment();
    await tabManager.init(mockContext);

    const startedEvents: any[] = [];
    const completedEvents: any[] = [];
    emitter.onEvent('navigation.started', (data) => startedEvents.push(data));
    emitter.onEvent('navigation.completed', (data) => completedEvents.push(data));

    await pageManager.navigate('https://target-site.com/docs');

    expect(mockPage.goto).toHaveBeenCalledWith('https://target-site.com/docs', {
      waitUntil: 'load',
      timeout: undefined,
    });
    expect(startedEvents).toHaveLength(1);
    expect(startedEvents[0].url).toBe('https://target-site.com/docs');
    expect(completedEvents).toHaveLength(1);
  });

  it('should convert Playwright timeout error to BrowserError with NAVIGATION_TIMEOUT code', async () => {
    const { mockPage, mockContext } = createMockEnvironment();
    await tabManager.init(mockContext);

    mockPage.goto = vi.fn().mockRejectedValue(new Error('Timeout 30000ms exceeded while waiting for page'));

    await expect(pageManager.navigate('https://slow-site.com', 'load', 30000)).rejects.toThrow(BrowserError);

    try {
      await pageManager.navigate('https://slow-site.com', 'load', 30000);
    } catch (err: any) {
      expect(err.code).toBe(ErrorCodes.NAVIGATION_TIMEOUT);
    }
  });
});

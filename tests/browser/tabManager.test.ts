import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BrowserContext, Page } from 'playwright-core';
import { TabManager } from '../../src/browser/TabManager.js';
import { BrowserEventEmitter } from '../../src/browser/BrowserEvents.js';
import { Logger } from '../../src/logging/Logger.js';

function createMockPage(initialUrl = 'about:blank') {
  let currentUrl = initialUrl;
  let isClosed = false;
  const listeners: Record<string, Function[]> = {};

  const page = {
    url: vi.fn(() => currentUrl),
    title: vi.fn(async () => `Title of ${currentUrl}`),
    isClosed: vi.fn(() => isClosed),
    bringToFront: vi.fn(async () => {}),
    goto: vi.fn(async (url: string) => {
      currentUrl = url;
    }),
    close: vi.fn(async () => {
      isClosed = true;
      if (listeners['close']) {
        listeners['close'].forEach((fn) => fn());
      }
    }),
    on: vi.fn((event: string, handler: Function) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(handler);
      return page;
    }),
    once: vi.fn((event: string, handler: Function) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(handler);
      return page;
    }),
    mainFrame: vi.fn(() => ({})),
  } as unknown as Page;

  return { page, listeners };
}

function createMockContext(initialPages: Page[] = []) {
  const contextListeners: Record<string, Function[]> = {};
  const pagesList: Page[] = [...initialPages];

  const context = {
    pages: vi.fn(() => [...pagesList]),
    newPage: vi.fn(async () => {
      const { page } = createMockPage();
      pagesList.push(page);
      return page;
    }),
    on: vi.fn((event: string, handler: Function) => {
      contextListeners[event] = contextListeners[event] || [];
      contextListeners[event].push(handler);
      return context;
    }),
  } as unknown as BrowserContext;

  return { context, pagesList, contextListeners };
}

describe('TabManager Subsystem', () => {
  let emitter: BrowserEventEmitter;
  let logger: Logger;
  let tabManager: TabManager;

  beforeEach(() => {
    emitter = new BrowserEventEmitter();
    logger = new Logger('debug', () => {});
    tabManager = new TabManager(emitter, logger);
  });

  it('should initialize and discover or create the initial tab with stable ID tab_001', async () => {
    const { page } = createMockPage('https://example.com');
    const { context } = createMockContext([page]);

    await tabManager.init(context);

    const tabs = tabManager.listTabs();
    expect(tabs).toHaveLength(1);
    expect(tabs[0].id).toBe('tab_001');
    expect(tabs[0].url).toBe('https://example.com');
    expect(tabs[0].active).toBe(true);
  });

  it('should create new tabs with incrementing stable IDs', async () => {
    const { context } = createMockContext();
    await tabManager.init(context);

    const tab2 = await tabManager.newTab('https://site-a.com');
    const tab3 = await tabManager.newTab('https://site-b.com');

    expect(tab2.id).toBe('tab_002');
    expect(tab3.id).toBe('tab_003');

    const activeTab = tabManager.getActiveTab();
    expect(activeTab?.id).toBe('tab_003');

    const tabs = tabManager.listTabs();
    expect(tabs).toHaveLength(3); // tab_001 (init), tab_002, tab_003
  });

  it('should switch active tab and emit tab.activated event', async () => {
    const { context } = createMockContext();
    await tabManager.init(context);

    await tabManager.newTab('https://site-a.com'); // tab_002

    const activatedEvents: any[] = [];
    emitter.onEvent('tab.activated', (data) => activatedEvents.push(data));

    const switched = await tabManager.switchTab('tab_001');
    expect(switched.id).toBe('tab_001');
    expect(switched.active).toBe(true);

    expect(activatedEvents).toHaveLength(1);
    expect(activatedEvents[0].id).toBe('tab_001');
  });

  it('should close tab, emit tab.closed event, and activate remaining tab', async () => {
    const { context } = createMockContext();
    await tabManager.init(context);

    await tabManager.newTab('https://site-a.com'); // tab_002

    const closedEvents: any[] = [];
    emitter.onEvent('tab.closed', (data) => closedEvents.push(data));

    // Close active tab tab_002
    await tabManager.closeTab('tab_002');

    expect(closedEvents).toHaveLength(1);
    expect(closedEvents[0].tabId).toBe('tab_002');

    expect(tabManager.listTabs()).toHaveLength(1);
    expect(tabManager.getActiveTab()?.id).toBe('tab_001');
  });

  it('should preserve monotonic IDs and not collide after deletions', async () => {
    const { context } = createMockContext();
    await tabManager.init(context); // tab_001

    await tabManager.newTab(); // tab_002
    await tabManager.closeTab('tab_002');

    const tab4 = await tabManager.newTab(); // Should be tab_003, not tab_002
    expect(tab4.id).toBe('tab_003');
  });
});

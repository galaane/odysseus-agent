import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrowserManager } from '../../src/browser/BrowserManager.js';
import { loadConfig } from '../../src/config/Config.js';
import { Logger } from '../../src/logging/Logger.js';

// Mock cloakbrowser launchPersistentContext
vi.mock('cloakbrowser', () => {
  return {
    launchPersistentContext: vi.fn().mockImplementation(async (options: any) => {
      const listeners: Record<string, Function[]> = {};
      let pageCount = 0;

      const createPage = (url = 'about:blank') => {
        pageCount += 1;
        const pageListeners: Record<string, Function[]> = {};
        let currentUrl = url;
        let isClosed = false;

        const p = {
          url: () => currentUrl,
          title: async () => `Title for ${currentUrl}`,
          isClosed: () => isClosed,
          bringToFront: async () => {},
          goto: async (newUrl: string) => {
            currentUrl = newUrl;
          },
          close: async () => {
            isClosed = true;
            if (pageListeners['close']) pageListeners['close'].forEach((fn) => fn());
          },
          on: (event: string, fn: Function) => {
            pageListeners[event] = pageListeners[event] || [];
            pageListeners[event].push(fn);
            return p;
          },
          once: (event: string, fn: Function) => {
            pageListeners[event] = pageListeners[event] || [];
            pageListeners[event].push(fn);
            return p;
          },
          mainFrame: () => ({}),
        };
        return p;
      };

      const pagesList = [createPage('https://initial.example.com')];

      const mockContext = {
        userDataDir: options.userDataDir,
        options,
        pages: () => [...pagesList],
        newPage: async () => {
          const p = createPage();
          pagesList.push(p);
          if (listeners['page']) {
            listeners['page'].forEach((fn) => fn(p));
          }
          return p;
        },
        on: (event: string, handler: Function) => {
          listeners[event] = listeners[event] || [];
          listeners[event].push(handler);
        },
        close: async () => {
          if (listeners['close']) {
            listeners['close'].forEach((fn) => fn());
          }
        },
      };

      return mockContext;
    }),
  };
});

describe('BrowserState Integration Subsystem', () => {
  let config: ReturnType<typeof loadConfig>;
  let logger: Logger;
  let browserManager: BrowserManager;

  beforeEach(async () => {
    BrowserManager.resetInstanceForTesting();
    config = loadConfig({
      BROWSER_PROFILE_PATH: './data/test-browser-profile',
      BROWSER_HEADLESS: 'true',
    });
    logger = new Logger('debug', () => {});
    browserManager = BrowserManager.getInstance(config, logger);
  });

  afterEach(async () => {
    await browserManager.stop();
    BrowserManager.resetInstanceForTesting();
  });

  it('should return initial BrowserState snapshot matching interface', async () => {
    await browserManager.start();

    const state = browserManager.getBrowserState();
    expect(state.connected).toBe(true);
    expect(state.currentTabId).toBe('tab_001');
    expect(state.currentUrl).toBe('https://initial.example.com');
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0].id).toBe('tab_001');
    expect(state.tabs[0].active).toBe(true);
  });

  it('should reflect multiple tabs and active tab switches in BrowserState', async () => {
    await browserManager.start();
    const tabManager = browserManager.getTabManager();

    await tabManager.newTab('https://second-page.com');

    let state = browserManager.getBrowserState();
    expect(state.tabs).toHaveLength(2);
    expect(state.currentTabId).toBe('tab_002');
    expect(state.currentUrl).toBe('https://second-page.com');

    // Switch back to tab_001
    await tabManager.switchTab('tab_001');
    state = browserManager.getBrowserState();
    expect(state.currentTabId).toBe('tab_001');
    expect(state.currentUrl).toBe('https://initial.example.com');
  });

  it('should reflect tab closures in BrowserState', async () => {
    await browserManager.start();
    const tabManager = browserManager.getTabManager();

    await tabManager.newTab('https://temp.com');
    expect(browserManager.getBrowserState().tabs).toHaveLength(2);

    await tabManager.closeTab('tab_002');
    const state = browserManager.getBrowserState();
    expect(state.tabs).toHaveLength(1);
    expect(state.currentTabId).toBe('tab_001');
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrowserManager } from '../../src/browser/BrowserManager.js';
import { BrowserError, ErrorCodes } from '../../src/browser/BrowserError.js';
import { loadConfig } from '../../src/config/Config.js';
import { Logger } from '../../src/logging/Logger.js';

// Mock cloakbrowser launchPersistentContext
vi.mock('cloakbrowser', () => {
  return {
    launchPersistentContext: vi.fn().mockImplementation(async (options: any) => {
      const listeners: Record<string, Function[]> = {};

      const createMockPage = () => {
        let isPageClosed = false;
        const pageListeners: Record<string, Function[]> = {};
        const p = {
          url: () => 'about:blank',
          title: async () => 'Mock Page',
          isClosed: () => isPageClosed,
          bringToFront: async () => {},
          goto: async () => {},
          close: async () => {
            isPageClosed = true;
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

      const initialPage = createMockPage();
      const pagesList = [initialPage];

      const mockContext = {
        userDataDir: options.userDataDir,
        options,
        isClosed: false,
        on: vi.fn((event: string, handler: Function) => {
          listeners[event] = listeners[event] || [];
          listeners[event].push(handler);
        }),
        close: vi.fn(async () => {
          mockContext.isClosed = true;
          if (listeners['close']) {
            listeners['close'].forEach((fn) => fn());
          }
        }),
        pages: vi.fn(() => [...pagesList]),
        newPage: vi.fn(async () => {
          const p = createMockPage();
          pagesList.push(p);
          return p;
        }),
      };

      return mockContext;
    }),
  };
});

describe('BrowserManager Subsystem', () => {
  let config: ReturnType<typeof loadConfig>;
  let logger: Logger;

  beforeEach(() => {
    BrowserManager.resetInstanceForTesting();
    config = loadConfig({
      BROWSER_PROFILE_PATH: './data/test-browser-profile',
      BROWSER_HEADLESS: 'true',
    });
    logger = new Logger('debug', () => {});
  });

  afterEach(async () => {
    const manager = BrowserManager.getInstance(config, logger);
    await manager.stop();
    BrowserManager.resetInstanceForTesting();
  });

  it('should enforce the Singleton pattern (Invariant 1 & 2)', () => {
    const instance1 = BrowserManager.getInstance(config, logger);
    const instance2 = BrowserManager.getInstance(config, logger);
    expect(instance1).toBe(instance2);
  });

  it('should throw BROWSER_NOT_CONNECTED when accessing context before start()', () => {
    const manager = BrowserManager.getInstance(config, logger);
    expect(manager.isHealthy()).toBe(false);

    expect(() => manager.getContext()).toThrow(BrowserError);
    try {
      manager.getContext();
    } catch (err: any) {
      expect(err.code).toBe(ErrorCodes.BROWSER_NOT_CONNECTED);
    }
  });

  it('should launch persistent browser context and report healthy', async () => {
    const manager = BrowserManager.getInstance(config, logger);
    const context = await manager.start();

    expect(context).toBeDefined();
    expect(manager.isHealthy()).toBe(true);
    expect(manager.getContext()).toBe(context);
  });

  it('should reject creating a second browser session (Invariant 2)', async () => {
    const manager = BrowserManager.getInstance(config, logger);
    await manager.start();

    await expect(manager.start()).rejects.toThrow(BrowserError);
    try {
      await manager.start();
    } catch (err: any) {
      expect(err.code).toBe(ErrorCodes.BROWSER_ALREADY_RUNNING);
    }
  });

  it('should execute actions under mutex lock via runWithLock (Invariant 13)', async () => {
    const manager = BrowserManager.getInstance(config, logger);
    await manager.start();

    const result = await manager.runWithLock(async (context) => {
      expect(context).toBeDefined();
      return 'action_success';
    });

    expect(result).toBe('action_success');
    expect(manager.getMutex().isLocked()).toBe(false);
  });

  it('should handle context closure and clean shutdown', async () => {
    const manager = BrowserManager.getInstance(config, logger);
    await manager.start();
    expect(manager.isHealthy()).toBe(true);

    await manager.stop();
    expect(manager.isHealthy()).toBe(false);
  });
});

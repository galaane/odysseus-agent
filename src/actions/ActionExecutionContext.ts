import type { Page, Locator } from 'playwright-core';
import type { BrowserManager } from '../browser/BrowserManager.js';
import type { Logger } from '../logging/Logger.js';
import type { MemoryManager } from '../memory/MemoryManager.js';
import type { ResearchRepository } from '../persistence/ResearchRepository.js';
import type { NetworkObserver } from '../observer/NetworkObserver.js';

export interface ElementResolver {
  resolveLocator(targetId: string, page: Page): Locator;
}

export interface ActionExecutionContext {
  page: Page;
  tabId: string;
  browserManager: BrowserManager;
  logger: Logger;
  elementResolver?: ElementResolver;
  screenshotDir?: string;
  taskId?: string;
  memoryManager?: MemoryManager;
  researchRepo?: ResearchRepository;
  networkObserver?: NetworkObserver;
}

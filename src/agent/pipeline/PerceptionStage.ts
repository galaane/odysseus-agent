import type { Page } from 'playwright-core';
import type { BrowserManager } from '../../browser/BrowserManager.js';
import type { PageObserver } from '../../observer/PageObserver.js';
import type { ScreenshotObserver } from '../../observer/ScreenshotObserver.js';
import type { MemoryManager } from '../../memory/MemoryManager.js';
import type { ResearchRepository } from '../../persistence/ResearchRepository.js';
import type { Logger } from '../../logging/Logger.js';
import { AgentError } from '../AgentError.js';
import { ErrorCodes } from '../../browser/BrowserError.js';
import type { IPerceptionStage, LoopIterationContext } from './types.js';

export interface PerceptionStageOptions {
  browserManager: BrowserManager;
  pageObserver: PageObserver;
  screenshotObserver: ScreenshotObserver;
  memoryManager: MemoryManager;
  researchRepo?: ResearchRepository;
  logger: Logger;
}

export class PerceptionStage implements IPerceptionStage {
  private browserManager: BrowserManager;
  private pageObserver: PageObserver;
  private screenshotObserver: ScreenshotObserver;
  private memoryManager: MemoryManager;
  private researchRepo?: ResearchRepository;
  private logger: Logger;

  constructor(options: PerceptionStageOptions) {
    this.browserManager = options.browserManager;
    this.pageObserver = options.pageObserver;
    this.screenshotObserver = options.screenshotObserver;
    this.memoryManager = options.memoryManager;
    this.researchRepo = options.researchRepo;
    this.logger = options.logger;
  }

  public async execute(context: LoopIterationContext): Promise<void> {
    const pageManager = this.browserManager.getPageManager();
    const tabManager = this.browserManager.getTabManager();

    let activePage: Page;
    try {
      activePage = pageManager.getActivePage();
    } catch {
      const browserCtx = this.browserManager.getContext();
      if (!browserCtx) {
        throw new AgentError(ErrorCodes.BROWSER_NOT_CONNECTED, 'Browser context is not initialized');
      }
      activePage = await browserCtx.newPage();
    }

    const activeTab = tabManager.getActiveTab();
    const activeTabId = activeTab ? activeTab.id : 'tab_001';
    const currentSnapshot = await this.pageObserver.observePage(activePage, activeTabId);

    let screenshotBase64: string | undefined;
    try {
      if (currentSnapshot.interactiveElements && currentSnapshot.interactiveElements.length > 0) {
        screenshotBase64 = await this.screenshotObserver.captureAnnotatedBase64(
          activePage,
          currentSnapshot.interactiveElements
        );
      } else {
        screenshotBase64 = await this.screenshotObserver.captureBase64(activePage);
      }
    } catch {
      // Soft fail for base64 capture (e.g. page navigating or mock context)
    }

    context.activePage = activePage;
    context.activeTabId = activeTabId;
    context.currentSnapshot = currentSnapshot;
    context.screenshotBase64 = screenshotBase64;

    // Record visited source URL and update domain memory
    if (currentSnapshot.url && currentSnapshot.url !== 'about:blank') {
      const existingSource = context.sources.find((s) => s.url === currentSnapshot.url);
      if (!existingSource) {
        context.sources.push({
          url: currentSnapshot.url,
          title: currentSnapshot.title,
          accessedAt: new Date().toISOString(),
        });
      }

      // Memory tracking
      this.memoryManager.getTaskMemory().addVisitedUrl(currentSnapshot.url);
      this.memoryManager.getResearchMemory().addSource({
        url: currentSnapshot.url,
        title: currentSnapshot.title,
      });

      if (this.researchRepo && !this.researchRepo.getSourceByUrl(context.task.id, currentSnapshot.url)) {
        try {
          const parsedDomain = new URL(currentSnapshot.url).hostname;
          this.researchRepo.saveSource({
            id: `src_${context.task.id}_${Date.now()}`,
            task_id: context.task.id,
            url: currentSnapshot.url,
            title: currentSnapshot.title || null,
            domain: parsedDomain,
            accessed_at: new Date().toISOString(),
            relevance: 1.0,
          });
          this.memoryManager.getWorkingMemory().clearForDomainChange(parsedDomain);
        } catch {
          // Ignore URL parse errors
        }
      }
    }
  }
}

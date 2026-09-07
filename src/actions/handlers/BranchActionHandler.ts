import type { BranchTabAction, PruneBranchAction, PromoteBranchAction } from '../Action.js';
import type { ActionExecutionContext } from '../ActionExecutionContext.js';

export class BranchActionHandler {
  public async handleBranchTab(
    action: BranchTabAction,
    context: ActionExecutionContext
  ): Promise<{ observationDelta?: unknown }> {
    const { browserManager, tabId, page, elementResolver, logger } = context;
    const branchManager = browserManager.getTabBranchManager();

    let targetUrl = action.url;
    if (!targetUrl && action.targetId) {
      try {
        const locator = elementResolver
          ? elementResolver.resolveLocator(action.targetId, page)
          : page.locator(action.targetId);
        const href = await locator.getAttribute('href');
        if (href) {
          targetUrl = new URL(href, page.url()).href;
        }
      } catch {
        // Soft fail href extraction fallback
      }
    }

    logger.info('BranchActionHandler', `Creating speculative branch from parent tab ${tabId}`, {
      parentTabId: tabId,
      url: targetUrl,
      branchGoal: action.branchGoal,
    });

    const branch = await branchManager.createBranch(tabId, targetUrl, action.branchGoal);

    return {
      observationDelta: {
        branchId: branch.branchId,
        branchTabId: branch.tabId,
        branchGoal: branch.branchGoal,
        parentTabId: tabId,
        entryUrl: branch.entryUrl,
        activeBranchesCount: branchManager.getActiveBranches().length,
      },
    };
  }

  public async handlePruneBranch(
    action: PruneBranchAction,
    context: ActionExecutionContext
  ): Promise<{ observationDelta?: unknown }> {
    const { browserManager, tabId, logger } = context;
    const branchManager = browserManager.getTabBranchManager();
    const targetIdentifier = action.tabId || action.branchId || tabId;

    logger.info('BranchActionHandler', `Pruning branch ${targetIdentifier}: ${action.reason}`);
    const pruned = await branchManager.pruneBranch(targetIdentifier, action.reason);

    return {
      observationDelta: {
        prunedBranchId: pruned?.branchId,
        prunedTabId: pruned?.tabId,
        reason: action.reason,
        remainingActiveBranches: branchManager.getActiveBranches().length,
      },
    };
  }

  public async handlePromoteBranch(
    action: PromoteBranchAction,
    context: ActionExecutionContext
  ): Promise<{ observationDelta?: unknown }> {
    const { browserManager, tabId, logger } = context;
    const branchManager = browserManager.getTabBranchManager();
    const targetIdentifier = action.tabId || action.branchId || tabId;

    logger.info('BranchActionHandler', `Promoting branch ${targetIdentifier} to primary alur`);
    const promoted = await branchManager.promoteBranch(targetIdentifier);

    return {
      observationDelta: {
        promotedBranchId: promoted.branchId,
        promotedTabId: promoted.tabId,
        branchGoal: promoted.branchGoal,
      },
    };
  }
}

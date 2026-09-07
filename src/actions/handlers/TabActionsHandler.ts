import type { NewTabAction, SwitchTabAction, CloseTabAction } from '../Action.js';
import type { ActionExecutionContext } from '../ActionExecutionContext.js';

export class TabActionsHandler {
  public async handleNewTab(action: NewTabAction, context: ActionExecutionContext): Promise<{ observationDelta?: unknown }> {
    const { browserManager, logger } = context;
    const tabManager = browserManager.getTabManager();

    logger.info('TabActionsHandler', 'Opening new tab', { url: action.url });
    const tab = await tabManager.newTab(action.url);

    return {
      observationDelta: {
        createdTabId: tab.id,
        url: tab.url,
      },
    };
  }

  public async handleSwitchTab(action: SwitchTabAction, context: ActionExecutionContext): Promise<{ observationDelta?: unknown }> {
    const { browserManager, logger } = context;
    const tabManager = browserManager.getTabManager();

    logger.info('TabActionsHandler', `Switching to tab ${action.tabId}`, { tabId: action.tabId });
    const tab = await tabManager.switchTab(action.tabId);

    return {
      observationDelta: {
        activeTabId: tab.id,
        url: tab.url,
      },
    };
  }

  public async handleCloseTab(action: CloseTabAction, context: ActionExecutionContext): Promise<{ observationDelta?: unknown }> {
    const { browserManager, logger } = context;
    const tabManager = browserManager.getTabManager();

    logger.info('TabActionsHandler', `Closing tab ${action.tabId}`, { tabId: action.tabId });
    await tabManager.closeTab(action.tabId);

    return {
      observationDelta: {
        closedTabId: action.tabId,
        remainingTabsCount: tabManager.listTabs().length,
      },
    };
  }
}

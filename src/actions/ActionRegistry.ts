import type { BrowserAction } from './Action.js';
import type { ActionResult } from './ActionResult.js';
import type { ActionExecutionContext } from './ActionExecutionContext.js';
import { NavigateHandler } from './handlers/NavigateHandler.js';
import { ClickHandler } from './handlers/ClickHandler.js';
import { InputHandler } from './handlers/InputHandler.js';
import { ScrollHandler } from './handlers/ScrollHandler.js';
import { WaitHandler } from './handlers/WaitHandler.js';
import { ScreenshotHandler } from './handlers/ScreenshotHandler.js';
import { TabActionsHandler } from './handlers/TabActionsHandler.js';
import { ExtractHandler } from './handlers/ExtractHandler.js';
import { BranchActionHandler } from './handlers/BranchActionHandler.js';
import { HarvestPayloadHandler } from './handlers/HarvestPayloadHandler.js';
import { BrowserError, ErrorCodes, type ErrorCode } from '../browser/BrowserError.js';

export class ActionRegistry {
  private navigateHandler = new NavigateHandler();
  private clickHandler = new ClickHandler();
  private inputHandler = new InputHandler();
  private scrollHandler = new ScrollHandler();
  private waitHandler = new WaitHandler();
  private screenshotHandler = new ScreenshotHandler();
  private tabActionsHandler = new TabActionsHandler();
  private extractHandler = new ExtractHandler();
  private branchActionHandler = new BranchActionHandler();
  private harvestPayloadHandler = new HarvestPayloadHandler();

  /**
   * Dispatches a typed BrowserAction to its corresponding handler under the ActionMutex.
   */
  public async dispatch(action: BrowserAction, context: ActionExecutionContext): Promise<ActionResult> {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();

    try {
      // Execute the action inside the BrowserManager ActionMutex lock
      const deltaResult = await context.browserManager.runWithLock(async () => {
        switch (action.type) {
          case 'navigate':
            return await this.navigateHandler.execute(action, context);
          case 'click':
            return await this.clickHandler.execute(action, context);
          case 'fill':
            return await this.inputHandler.handleFill(action, context);
          case 'type':
            return await this.inputHandler.handleType(action, context);
          case 'press':
            return await this.inputHandler.handlePress(action, context);
          case 'scroll':
            return await this.scrollHandler.execute(action, context);
          case 'wait':
            return await this.waitHandler.execute(action, context);
          case 'screenshot':
            return await this.screenshotHandler.execute(action, context);
          case 'new_tab':
            return await this.tabActionsHandler.handleNewTab(action, context);
          case 'switch_tab':
            return await this.tabActionsHandler.handleSwitchTab(action, context);
          case 'close_tab':
            return await this.tabActionsHandler.handleCloseTab(action, context);
          case 'extract':
            return await this.extractHandler.execute(action, context);
          case 'branch_tab':
            return await this.branchActionHandler.handleBranchTab(action, context);
          case 'prune_branch':
            return await this.branchActionHandler.handlePruneBranch(action, context);
          case 'promote_branch':
            return await this.branchActionHandler.handlePromoteBranch(action, context);
          case 'harvest_network_payload':
            return await this.harvestPayloadHandler.execute(action, context);
          default: {
            const exhaustiveCheck: never = action;
            throw new Error(`Unhandled action type: ${(exhaustiveCheck as { type?: unknown })?.type}`);
          }
        }
      });

      const finishedAt = new Date().toISOString();
      const durationMs = Date.now() - startTime;

      return {
        actionId: action.id,
        actionType: action.type,
        success: true,
        startedAt,
        finishedAt,
        durationMs,
        observationDelta: deltaResult.observationDelta,
      };
    } catch (err: unknown) {
      const finishedAt = new Date().toISOString();
      const durationMs = Date.now() - startTime;

      let code: ErrorCode = ErrorCodes.UNKNOWN_ERROR;
      let message = 'An unexpected error occurred during action execution';

      if (err instanceof BrowserError) {
        code = err.code;
        message = err.message;
      } else if (err instanceof Error) {
        message = err.message;
      }

      context.logger.error('ActionRegistry', `Action ${action.type} [${action.id}] failed: ${message}`, {
        actionId: action.id,
        actionType: action.type,
        code,
      });

      return {
        actionId: action.id,
        actionType: action.type,
        success: false,
        startedAt,
        finishedAt,
        durationMs,
        error: {
          code,
          message,
        },
      };
    }
  }
}

import type { TabManager } from './TabManager.js';
import { BrowserError, ErrorCodes } from './BrowserError.js';
import type { Logger } from '../logging/Logger.js';

export interface SpeculativeBranch {
  branchId: string;
  parentTabId: string;
  tabId: string;
  branchGoal: string;
  entryUrl?: string;
  createdAt: string;
  status: 'active' | 'pruned' | 'promoted';
  pruneReason?: string;
}

export class TabBranchManager {
  private branches = new Map<string, SpeculativeBranch>(); // branchId -> Branch
  private tabToBranch = new Map<string, string>(); // tabId -> branchId
  private branchCounter = 0;
  public readonly maxConcurrentBranches: number;

  constructor(
    private tabManager: TabManager,
    private logger: Logger,
    maxConcurrentBranches = 3
  ) {
    this.maxConcurrentBranches = maxConcurrentBranches;
  }

  /**
   * Creates a new speculative tab branch stemming from a parent tab.
   */
  public async createBranch(
    parentTabId: string,
    url?: string,
    branchGoal?: string
  ): Promise<SpeculativeBranch> {
    const activeBranches = this.getActiveBranches();
    if (activeBranches.length >= this.maxConcurrentBranches) {
      throw new BrowserError(
        ErrorCodes.ACTION_TIMEOUT,
        `Maximum concurrent speculative branches limit (${this.maxConcurrentBranches}) reached. Prune an existing branch first.`
      );
    }

    const tabState = await this.tabManager.newTab(url);

    this.branchCounter++;
    const branchId = `branch_${String(this.branchCounter).padStart(3, '0')}`;

    const branch: SpeculativeBranch = {
      branchId,
      parentTabId,
      tabId: tabState.id,
      branchGoal: branchGoal || 'Speculative exploration',
      entryUrl: url || tabState.url,
      createdAt: new Date().toISOString(),
      status: 'active',
    };

    this.branches.set(branchId, branch);
    this.tabToBranch.set(tabState.id, branchId);

    this.logger.info(
      'TabBranchManager',
      `Created speculative branch ${branchId} in tab ${tabState.id} (parent: ${parentTabId})`,
      { branchId, tabId: tabState.id, parentTabId, branchGoal: branch.branchGoal }
    );

    return branch;
  }

  /**
   * Prunes a speculative branch (closes the tab and marks it as pruned).
   * If the pruned tab was active, returns focus back to the parent tab.
   */
  public async pruneBranch(identifier: string, reason: string): Promise<SpeculativeBranch | undefined> {
    const branch = this.resolveBranch(identifier);
    if (!branch || branch.status !== 'active') {
      return undefined;
    }

    branch.status = 'pruned';
    branch.pruneReason = reason;

    this.logger.info('TabBranchManager', `Pruning branch ${branch.branchId} in tab ${branch.tabId}: ${reason}`, {
      branchId: branch.branchId,
      tabId: branch.tabId,
      reason,
    });

    const activeTab = this.tabManager.getActiveTab();
    const wasActive = activeTab?.id === branch.tabId;

    await this.tabManager.closeTab(branch.tabId);

    // Switch focus back to parent tab if pruned tab was the active one
    if (wasActive && branch.parentTabId) {
      const remainingTabs = this.tabManager.listTabs();
      const parentStillExists = remainingTabs.some((t) => t.id === branch.parentTabId);
      if (parentStillExists) {
        await this.tabManager.switchTab(branch.parentTabId);
      }
    }

    return branch;
  }

  /**
   * Promotes a speculative branch to become the main primary tab.
   * Automatically switches to it and prunes all sibling active branches under the same parent tab.
   */
  public async promoteBranch(identifier: string): Promise<SpeculativeBranch> {
    const branch = this.resolveBranch(identifier);
    if (!branch) {
      throw new BrowserError(
        ErrorCodes.ELEMENT_NOT_FOUND,
        `Speculative branch "${identifier}" does not exist.`
      );
    }

    if (branch.status !== 'active') {
      throw new BrowserError(
        ErrorCodes.ELEMENT_NOT_FOUND,
        `Cannot promote branch "${branch.branchId}" with status "${branch.status}".`
      );
    }

    branch.status = 'promoted';
    this.logger.info(
      'TabBranchManager',
      `Promoting branch ${branch.branchId} (tab ${branch.tabId}) to primary alur`,
      { branchId: branch.branchId, tabId: branch.tabId }
    );

    // Switch active tab to the promoted branch
    await this.tabManager.switchTab(branch.tabId);

    // Prune all other sibling active branches under the same parent
    const activeSiblings = this.getActiveBranches(branch.parentTabId).filter(
      (b) => b.branchId !== branch.branchId
    );

    for (const sibling of activeSiblings) {
      await this.pruneBranch(
        sibling.branchId,
        `Sibling branch pruned upon promotion of ${branch.branchId}`
      );
    }

    return branch;
  }

  /**
   * Returns all active speculative branches, optionally filtered by parentTabId.
   */
  public getActiveBranches(parentTabId?: string): SpeculativeBranch[] {
    const active: SpeculativeBranch[] = [];
    for (const b of this.branches.values()) {
      if (b.status === 'active') {
        if (!parentTabId || b.parentTabId === parentTabId) {
          active.push(b);
        }
      }
    }
    return active;
  }

  /**
   * Returns all recorded branches regardless of status.
   */
  public getAllBranches(): SpeculativeBranch[] {
    return Array.from(this.branches.values());
  }

  /**
   * Resolves a branch by branchId or by tabId.
   */
  public resolveBranch(identifier: string): SpeculativeBranch | undefined {
    if (this.branches.has(identifier)) {
      return this.branches.get(identifier);
    }
    const branchId = this.tabToBranch.get(identifier);
    if (branchId && this.branches.has(branchId)) {
      return this.branches.get(branchId);
    }
    return undefined;
  }

  /**
   * Resets all branch tracking records.
   */
  public clear(): void {
    this.branches.clear();
    this.tabToBranch.clear();
  }
}

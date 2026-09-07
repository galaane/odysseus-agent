import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TabBranchManager } from '../../src/browser/TabBranchManager.js';
import type { TabManager } from '../../src/browser/TabManager.js';
import { BranchActionHandler } from '../../src/actions/handlers/BranchActionHandler.js';
import { ActionValidator } from '../../src/actions/ActionValidator.js';
import { Logger } from '../../src/logging/Logger.js';
import type { ActionExecutionContext } from '../../src/actions/ActionExecutionContext.js';
import type { BrowserManager } from '../../src/browser/BrowserManager.js';
import type { Page } from 'playwright-core';

describe('Phase 25: Speculative Multi-Tab Branching Subsystem', () => {
  let mockTabManager: TabManager;
  let mockLogger: Logger;
  let branchManager: TabBranchManager;
  let tabCounter = 0;

  beforeEach(() => {
    tabCounter = 0;
    mockLogger = new Logger('debug', () => {});

    const openTabs = new Map<string, { id: string; url: string }>();

    mockTabManager = {
      newTab: vi.fn().mockImplementation(async (url?: string) => {
        tabCounter++;
        const id = `tab_${String(tabCounter).padStart(3, '0')}`;
        const tab = { id, url: url || 'about:blank' };
        openTabs.set(id, tab);
        return tab;
      }),
      closeTab: vi.fn().mockImplementation(async (id: string) => {
        openTabs.delete(id);
      }),
      switchTab: vi.fn().mockImplementation(async (id: string) => {
        return openTabs.get(id) || { id, url: 'about:blank' };
      }),
      getActiveTab: vi.fn().mockImplementation(() => {
        const last = Array.from(openTabs.values()).pop();
        return last || null;
      }),
      listTabs: vi.fn().mockImplementation(() => Array.from(openTabs.values())),
    } as unknown as TabManager;

    branchManager = new TabBranchManager(mockTabManager, mockLogger, 3);
  });

  describe('TabBranchManager Lifecycle', () => {
    it('should create speculative branches with monotonic IDs', async () => {
      const branch1 = await branchManager.createBranch('tab_001', 'https://shop.test/product-a', 'Inspect Product A');

      expect(branch1.branchId).toBe('branch_001');
      expect(branch1.parentTabId).toBe('tab_001');
      expect(branch1.tabId).toBe('tab_001');
      expect(branch1.status).toBe('active');
      expect(branch1.branchGoal).toBe('Inspect Product A');
      expect(branchManager.getActiveBranches()).toHaveLength(1);
    });

    it('should enforce maximum concurrent speculative branches limit', async () => {
      await branchManager.createBranch('tab_001', 'https://shop.test/a');
      await branchManager.createBranch('tab_001', 'https://shop.test/b');
      await branchManager.createBranch('tab_001', 'https://shop.test/c');

      expect(branchManager.getActiveBranches()).toHaveLength(3);

      await expect(
        branchManager.createBranch('tab_001', 'https://shop.test/d')
      ).rejects.toThrow('Maximum concurrent speculative branches limit (3) reached');
    });

    it('should prune dead-end branches and close their underlying tab', async () => {
      const branch1 = await branchManager.createBranch('tab_001', 'https://shop.test/a');
      expect(branchManager.getActiveBranches()).toHaveLength(1);

      const pruned = await branchManager.pruneBranch(branch1.tabId, 'Out of stock');
      expect(pruned?.status).toBe('pruned');
      expect(pruned?.pruneReason).toBe('Out of stock');
      expect(mockTabManager.closeTab).toHaveBeenCalledWith(branch1.tabId);
      expect(branchManager.getActiveBranches()).toHaveLength(0);
    });

    it('should promote a winning branch and prune all sibling branches', async () => {
      const branchA = await branchManager.createBranch('tab_001', 'https://shop.test/a', 'Check A');
      const branchB = await branchManager.createBranch('tab_001', 'https://shop.test/b', 'Check B');

      expect(branchManager.getActiveBranches('tab_001')).toHaveLength(2);

      const promoted = await branchManager.promoteBranch(branchA.branchId);

      expect(promoted.status).toBe('promoted');
      expect(mockTabManager.switchTab).toHaveBeenCalledWith(branchA.tabId);

      // Verify sibling branch B was automatically pruned
      const branchBRecord = branchManager.resolveBranch(branchB.branchId);
      expect(branchBRecord?.status).toBe('pruned');
      expect(branchBRecord?.pruneReason).toContain('Sibling branch pruned upon promotion');
      expect(mockTabManager.closeTab).toHaveBeenCalledWith(branchB.tabId);

      // No active branches remaining (one promoted, one pruned)
      expect(branchManager.getActiveBranches('tab_001')).toHaveLength(0);
    });
  });

  describe('BranchActionHandler Execution', () => {
    let mockBrowserManager: BrowserManager;
    let handler: BranchActionHandler;

    beforeEach(() => {
      mockBrowserManager = {
        getTabBranchManager: () => branchManager,
      } as unknown as BrowserManager;

      handler = new BranchActionHandler();
    });

    it('should handle branch_tab action cleanly', async () => {
      const context = {
        browserManager: mockBrowserManager,
        tabId: 'tab_parent',
        logger: mockLogger,
      } as unknown as ActionExecutionContext;

      const result = await handler.handleBranchTab(
        {
          id: 'act_01',
          type: 'branch_tab',
          url: 'https://shop.test/item-1',
          branchGoal: 'Verify discounts',
        },
        context
      );

      const delta = result.observationDelta as Record<string, unknown>;
      expect(delta.branchId).toBe('branch_001');
      expect(delta.branchGoal).toBe('Verify discounts');
      expect(delta.activeBranchesCount).toBe(1);
    });

    it('should extract href from element when targetId is provided in branch_tab', async () => {
      const mockPage = {
        url: () => 'https://shop.test/catalog',
        locator: vi.fn().mockReturnValue({
          getAttribute: vi.fn().mockResolvedValue('/item/details-99'),
        }),
      } as unknown as Page;

      const context = {
        browserManager: mockBrowserManager,
        tabId: 'tab_catalog',
        page: mockPage,
        logger: mockLogger,
      } as unknown as ActionExecutionContext;

      const result = await handler.handleBranchTab(
        {
          id: 'act_02',
          type: 'branch_tab',
          targetId: 'el_045',
          branchGoal: 'Inspect item 99',
        },
        context
      );

      const delta = result.observationDelta as Record<string, unknown>;
      expect(delta.entryUrl).toBe('https://shop.test/item/details-99');
      expect(delta.branchGoal).toBe('Inspect item 99');
    });

    it('should handle prune_branch and promote_branch actions', async () => {
      const context = {
        browserManager: mockBrowserManager,
        tabId: 'tab_parent',
        logger: mockLogger,
      } as unknown as ActionExecutionContext;

      // Create two branches
      await handler.handleBranchTab(
        { id: 'act_01', type: 'branch_tab', url: 'https://shop.test/1', branchGoal: 'B1' },
        context
      );
      await handler.handleBranchTab(
        { id: 'act_02', type: 'branch_tab', url: 'https://shop.test/2', branchGoal: 'B2' },
        context
      );

      // Prune branch 1
      const pruneResult = await handler.handlePruneBranch(
        { id: 'act_03', type: 'prune_branch', branchId: 'branch_001', reason: 'High shipping cost' },
        context
      );
      expect((pruneResult.observationDelta as Record<string, unknown>).prunedBranchId).toBe('branch_001');

      // Promote branch 2
      const promoteResult = await handler.handlePromoteBranch(
        { id: 'act_04', type: 'promote_branch', branchId: 'branch_002' },
        context
      );
      expect((promoteResult.observationDelta as Record<string, unknown>).promotedBranchId).toBe('branch_002');
    });
  });

  describe('ActionValidator for Branch Actions', () => {
    it('should validate branch_tab action schemas', () => {
      expect(() =>
        ActionValidator.validate({
          type: 'branch_tab',
          url: 'https://shop.test',
          branchGoal: 'Look for specs',
        })
      ).not.toThrow();

      expect(() =>
        ActionValidator.validate({
          type: 'prune_branch',
          reason: 'No results found',
        })
      ).not.toThrow();

      expect(() =>
        ActionValidator.validate({
          type: 'promote_branch',
          tabId: 'tab_005',
        })
      ).not.toThrow();
    });
  });
});

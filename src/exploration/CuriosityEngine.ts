import type { Page } from 'playwright-core';
import type { BrowserManager } from '../browser/BrowserManager.js';
import type { ActionRegistry } from '../actions/ActionRegistry.js';
import type { PageObserver } from '../observer/PageObserver.js';
import type { ActionMutex } from '../browser/ActionMutex.js';
import type { TopologyRepository } from '../persistence/TopologyRepository.js';
import type { SiteTopologyMapper } from './SiteTopologyMapper.js';
import type { CuriosityScorer } from './CuriosityScorer.js';
import type { MacroSynthesizer } from '../macros/MacroSynthesizer.js';
import type { Logger } from '../logging/Logger.js';
import type { ExplorationBudget, ExplorationReport, RouteNode } from './types.js';
import type { ActionExecutionContext } from '../actions/ActionExecutionContext.js';
import type { BrowserAction } from '../actions/Action.js';

export interface CuriosityEngineOptions {
  browserManager: BrowserManager;
  actionRegistry: ActionRegistry;
  pageObserver: PageObserver;
  actionMutex: ActionMutex;
  topologyRepo: TopologyRepository;
  topologyMapper: SiteTopologyMapper;
  scorer: CuriosityScorer;
  macroSynthesizer?: MacroSynthesizer;
  logger?: Logger;
}

export class CuriosityEngine {
  private static readonly DEFAULT_BUDGET: ExplorationBudget = {
    maxSteps: 25,
    maxDepth: 3,
    maxDurationMs: 120_000,
    sameOriginOnly: true,
  };

  constructor(private readonly options: CuriosityEngineOptions) {}

  /**
   * Autonomously explores a website domain, discovering routes, mapping affordances,
   * constructing topology graph, and synthesizing workflow macros for clean paths.
   */
  public async explore(
    startUrl: string,
    customBudget?: Partial<ExplorationBudget>
  ): Promise<ExplorationReport> {
    const budget: ExplorationBudget = {
      ...CuriosityEngine.DEFAULT_BUDGET,
      ...customBudget,
    };

    const startTime = Date.now();
    const { domain, path: initialPath } = this.options.topologyMapper.normalizeUrl(startUrl);

    this.options.logger?.info(
      'CuriosityEngine',
      `Starting autonomous exploration of domain [${domain}] from [${startUrl}] (maxSteps: ${budget.maxSteps}, maxDepth: ${budget.maxDepth})`
    );

    const visitedPaths = new Set<string>();
    const executedActions: BrowserAction[] = [];
    const discoveredNodes: RouteNode[] = [];
    let stepsExecuted = 0;
    let macrosSynthesized = 0;
    let currentDepth = 0;

    const pageManager = this.options.browserManager.getPageManager();
    let page: Page;
    try {
      page = pageManager.getActivePage();
    } catch {
      const browserCtx = this.options.browserManager.getContext();
      if (!browserCtx) {
        throw new Error('Browser context not initialized');
      }
      page = await browserCtx.newPage();
    }

    const tabId = 'exploration_tab';
    const taskId = `explore_${domain}_${Date.now()}`;

    // Initial navigation under mutex
    await this.options.actionMutex.runExclusive(async () => {
      await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
    });

    let currentPath = initialPath;

    while (
      stepsExecuted < budget.maxSteps &&
      Date.now() - startTime < budget.maxDurationMs &&
      currentDepth <= budget.maxDepth
    ) {
      // 1. Observe current page
      const snapshot = await this.options.pageObserver.observePage(page, tabId);
      const currentNode = this.options.topologyMapper.mapPage(snapshot, currentDepth);

      visitedPaths.add(currentNode.path);
      currentPath = currentNode.path;

      if (!discoveredNodes.some((n) => n.path === currentNode.path)) {
        discoveredNodes.push(currentNode);
      }

      // 2. Select candidates using CuriosityScorer with Safety Filter
      const candidates = this.options.scorer.rankCandidates(
        snapshot.interactiveElements || [],
        currentPath,
        {
          domain,
          visitedPaths,
        }
      );

      if (candidates.length === 0) {
        this.options.logger?.info(
          'CuriosityEngine',
          `No further safe unvisited candidates found at [${currentPath}]. Checking frontier...`
        );

        const frontier = this.options.topologyRepo.getUnexploredFrontier(domain, budget.maxDepth);
        if (frontier.length > 0) {
          const target = frontier[0];
          this.options.logger?.info('CuriosityEngine', `Jumping to frontier route [${target.path}]`);
          await this.options.actionMutex.runExclusive(async () => {
            await page.goto(new URL(target.path, startUrl).toString(), {
              waitUntil: 'domcontentloaded',
              timeout: 15_000,
            }).catch(() => {});
          });
          currentDepth = target.depth;
          stepsExecuted++;
          continue;
        } else {
          this.options.logger?.info('CuriosityEngine', 'Exploration frontier exhausted. Completing.');
          break;
        }
      }

      // 3. Pick top candidate
      const candidate = candidates[0];
      let action: BrowserAction;

      if (candidate.actionType === 'fill') {
        action = {
          id: `act_${Date.now()}_${stepsExecuted}`,
          type: 'fill',
          targetId: candidate.elementId,
          value: candidate.fillValue || 'laptop',
        };
      } else {
        action = {
          id: `act_${Date.now()}_${stepsExecuted}`,
          type: 'click',
          targetId: candidate.elementId,
        };
      }

      // 4. Dispatch action under ActionMutex
      const execContext: ActionExecutionContext = {
        page,
        tabId,
        browserManager: this.options.browserManager,
        logger: this.options.logger || ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger),
        elementResolver: this.options.pageObserver.getRegistry(),
        taskId,
      };

      const result = await this.options.actionMutex.runExclusive(async () => {
        return this.options.actionRegistry.dispatch(action, execContext);
      });

      stepsExecuted++;
      if (result.success) {
        executedActions.push(action);
      }

      // Small pause for DOM transition
      await new Promise((res) => setTimeout(res, 200));

      // 5. Observe post-action page to record edge transition
      const postSnapshot = await this.options.pageObserver.observePage(page, tabId);
      const { domain: postDomain, path: postPath } = this.options.topologyMapper.normalizeUrl(postSnapshot.url);

      // Same-origin check
      if (budget.sameOriginOnly && postDomain !== domain) {
        this.options.logger?.warn(
          'CuriosityEngine',
          `Discovered external domain [${postDomain}] outside same-origin budget. Navigating back.`
        );
        await this.options.actionMutex.runExclusive(async () => {
          await page.goBack().catch(() => {});
        });
        continue;
      }

      // Record transition edge
      if (postPath !== currentPath) {
        this.options.topologyMapper.recordTransition({
          domain,
          sourcePath: currentPath,
          targetPath: postPath,
          transitionType: candidate.actionType === 'fill' ? 'form_submit' : 'link_click',
          triggerSelector: candidate.targetSelector || '',
          triggerRole: candidate.targetRole,
          triggerName: candidate.targetName,
        });

        currentDepth++;
        currentPath = postPath;
      }
    }

    // 6. Post-exploration Macro Synthesis
    if (this.options.macroSynthesizer && executedActions.length >= 2) {
      try {
        const task = {
          id: taskId,
          goal: `Autonomous exploratory trajectory on ${domain}`,
        };
        const macro = this.options.macroSynthesizer.synthesizeFromTrajectory(
          task,
          domain,
          executedActions,
          { elementRegistry: this.options.pageObserver.getRegistry() }
        );
        if (macro) {
          macrosSynthesized++;
          this.options.logger?.info(
            'CuriosityEngine',
            `Synthesized autonomous workflow macro [${macro.id}] from exploration trajectory`
          );
        }
      } catch (err) {
        this.options.logger?.debug('CuriosityEngine', `Exploration macro synthesis skipped: ${String(err)}`);
      }
    }

    const durationMs = Date.now() - startTime;
    const allEdges = this.options.topologyRepo.getEdgesByDomain(domain);
    const allNodes = this.options.topologyRepo.getNodesByDomain(domain);
    const totalAffordances = allNodes.reduce((sum, n) => sum + n.affordances.length, 0);

    const report: ExplorationReport = {
      domain,
      routesDiscovered: allNodes.length,
      edgesMapped: allEdges.length,
      affordancesFound: totalAffordances,
      macrosSynthesized,
      durationMs,
      nodes: allNodes,
    };

    this.options.logger?.info(
      'CuriosityEngine',
      `Exploration completed for [${domain}]: ${report.routesDiscovered} routes, ${report.edgesMapped} edges, ${report.affordancesFound} affordances, ${report.macrosSynthesized} macros`
    );

    return report;
  }
}

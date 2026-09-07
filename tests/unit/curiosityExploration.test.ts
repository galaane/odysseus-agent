import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteDatabase } from '../../src/persistence/Database.js';
import { TopologyRepository } from '../../src/persistence/TopologyRepository.js';
import { CuriosityScorer } from '../../src/exploration/CuriosityScorer.js';
import { SiteTopologyMapper } from '../../src/exploration/SiteTopologyMapper.js';
import { CuriosityEngine } from '../../src/exploration/CuriosityEngine.js';
import { KnowledgeGraph } from '../../src/graph/KnowledgeGraph.js';
import { KnowledgeGraphRepository } from '../../src/persistence/KnowledgeGraphRepository.js';
import { MacroSynthesizer } from '../../src/macros/MacroSynthesizer.js';
import { WorkflowMacroRepository } from '../../src/persistence/WorkflowMacroRepository.js';
import { ReasoningStage } from '../../src/agent/pipeline/ReasoningStage.js';
import { ActionMutex } from '../../src/browser/ActionMutex.js';
import type { PageSnapshot } from '../../src/observer/PageSnapshot.js';
import type { RegisteredElement } from '../../src/observer/ElementRegistry.js';
import type { RouteNode, RouteEdge } from '../../src/exploration/types.js';
import { Logger } from '../../src/logging/Logger.js';
import type { LLMProvider } from '../../src/llm/LLM.js';

describe('Phase 34: Curiosity-Driven Autonomous Exploration & Site Topology Mapping', () => {
  let db: SqliteDatabase;
  let topoRepo: TopologyRepository;
  let logger: Logger;

  beforeEach(() => {
    db = new SqliteDatabase({ path: ':memory:' });
    topoRepo = new TopologyRepository(db);
    logger = new Logger('error');
  });

  afterEach(() => {
    db.close();
  });

  describe('CuriosityScorer & SafetyFilter', () => {
    let scorer: CuriosityScorer;

    beforeEach(() => {
      scorer = new CuriosityScorer();
    });

    it('should score navigation links with positive curiosity', () => {
      const element: RegisteredElement = {
        id: 'el_nav_1',
        role: 'link',
        name: 'Product Catalog',
        locatorStrategy: { type: 'css', selector: 'nav a[href="/catalog"]' },
      };

      const candidate = scorer.scoreCandidate(element, '/', { domain: 'shop.local' });
      expect(candidate.isSafe).toBe(true);
      expect(candidate.actionType).toBe('click');
      expect(candidate.curiosityScore).toBeGreaterThan(10);
      expect(candidate.targetPath).toBe('/catalog');
    });

    it('should score search inputs with high information gain priority', () => {
      const element: RegisteredElement = {
        id: 'el_search',
        role: 'searchbox',
        name: 'Search catalog',
        placeholder: 'Search for products...',
        locatorStrategy: { type: 'css', selector: 'input[name="search"]' },
      };

      const candidate = scorer.scoreCandidate(element, '/', { domain: 'shop.local' });
      expect(candidate.isSafe).toBe(true);
      expect(candidate.actionType).toBe('fill');
      expect(candidate.fillValue).toBe('laptop');
      expect(candidate.curiosityScore).toBeGreaterThanOrEqual(15);
    });

    it('should block destructive elements with Safety Filter (-Infinity)', () => {
      const destructiveKeywords = ['Logout', 'Delete Account', 'Cancel Subscription', 'Pay Now', 'Checkout'];

      for (const kw of destructiveKeywords) {
        const element: RegisteredElement = {
          id: `el_${kw.toLowerCase().replace(/\s+/g, '_')}`,
          role: 'button',
          name: kw,
          locatorStrategy: { type: 'css', selector: `button.${kw.toLowerCase().replace(/\s+/g, '-')}` },
        };

        const candidate = scorer.scoreCandidate(element, '/settings', { domain: 'shop.local' });
        expect(candidate.isSafe).toBe(false);
        expect(candidate.curiosityScore).toBe(-Infinity);
        expect(candidate.reasoning).toContain('Safety Filter triggered');
      }
    });

    it('should penalize previously visited paths and boost novel paths', () => {
      const element: RegisteredElement = {
        id: 'el_1',
        role: 'link',
        name: 'Pricing',
        locatorStrategy: { type: 'css', selector: 'a[href="/pricing"]' },
      };

      const novelCandidate = scorer.scoreCandidate(element, '/', {
        domain: 'shop.local',
        visitedPaths: new Set(['/about']),
      });

      const visitedCandidate = scorer.scoreCandidate(element, '/', {
        domain: 'shop.local',
        visitedPaths: new Set(['/pricing']),
      });

      expect(novelCandidate.curiosityScore).toBeGreaterThan(visitedCandidate.curiosityScore);
    });

    it('should rank candidates descending and filter out unsafe elements', () => {
      const elements: RegisteredElement[] = [
        {
          id: 'el_delete',
          role: 'button',
          name: 'Delete Project',
          locatorStrategy: { type: 'css', selector: '.btn-danger' },
        },
        {
          id: 'el_search',
          role: 'searchbox',
          name: 'Search documentation',
          placeholder: 'Search docs',
          locatorStrategy: { type: 'css', selector: '#search-input' },
        },
        {
          id: 'el_link',
          role: 'link',
          name: 'Documentation Guides',
          locatorStrategy: { type: 'css', selector: 'a[href="/guides"]' },
        },
      ];

      const ranked = scorer.rankCandidates(elements, '/', { domain: 'docs.local' });
      expect(ranked.length).toBe(2);
      expect(ranked.some((c) => c.elementId === 'el_delete')).toBe(false);
      expect(ranked[0].elementId).toBe('el_search');
      expect(ranked[1].elementId).toBe('el_link');
    });
  });

  describe('TopologyRepository SQLite Persistence', () => {
    it('should save and retrieve RouteNode with affordances and pattern', () => {
      const node: RouteNode = {
        id: 'shop.local:/products/:id',
        domain: 'shop.local',
        path: '/products/42',
        pattern: '/products/:id',
        title: 'Product 42 - Shop Local',
        archetype: 'ecommerce',
        affordances: [
          { type: 'cart', elementId: 'btn_cart', name: 'Add to Cart' },
          { type: 'search', elementId: 'in_search', name: 'Search' },
        ],
        depth: 1,
        visitedAt: Date.now(),
        createdAt: Date.now(),
      };

      topoRepo.saveNode(node);

      const fetched = topoRepo.getNode('shop.local', '/products/42');
      expect(fetched).not.toBeNull();
      expect(fetched?.pattern).toBe('/products/:id');
      expect(fetched?.archetype).toBe('ecommerce');
      expect(fetched?.affordances.length).toBe(2);
      expect(fetched?.affordances[0].type).toBe('cart');
    });

    it('should save and query RouteEdge transitions and build SiteTopology', () => {
      const edge1: RouteEdge = {
        id: 'shop.local:/->/catalog',
        domain: 'shop.local',
        sourcePath: '/',
        targetPath: '/catalog',
        transitionType: 'link_click',
        triggerSelector: 'nav a.catalog',
        triggerRole: 'link',
        triggerName: 'Catalog',
        weight: 1.0,
        createdAt: Date.now(),
      };

      const edge2: RouteEdge = {
        id: 'shop.local:/catalog->/product/1',
        domain: 'shop.local',
        sourcePath: '/catalog',
        targetPath: '/product/1',
        transitionType: 'link_click',
        triggerSelector: '.product-card a',
        triggerRole: 'link',
        triggerName: 'Item 1',
        weight: 1.0,
        createdAt: Date.now(),
      };

      topoRepo.saveEdge(edge1);
      topoRepo.saveEdge(edge2);

      const edges = topoRepo.getEdgesByDomain('shop.local');
      expect(edges.length).toBe(2);

      const edgesFromRoot = topoRepo.getEdgesFrom('shop.local', '/');
      expect(edgesFromRoot.length).toBe(1);
      expect(edgesFromRoot[0].targetPath).toBe('/catalog');
    });

    it('should compute shortest path using BFS over topology edges', () => {
      topoRepo.saveEdge({
        id: '1',
        domain: 'app.local',
        sourcePath: '/home',
        targetPath: '/dashboard',
        transitionType: 'link_click',
        triggerSelector: '#dash',
        weight: 1.0,
        createdAt: Date.now(),
      });
      topoRepo.saveEdge({
        id: '2',
        domain: 'app.local',
        sourcePath: '/dashboard',
        targetPath: '/settings',
        transitionType: 'link_click',
        triggerSelector: '#settings',
        weight: 1.0,
        createdAt: Date.now(),
      });
      topoRepo.saveEdge({
        id: '3',
        domain: 'app.local',
        sourcePath: '/settings',
        targetPath: '/billing',
        transitionType: 'link_click',
        triggerSelector: '#billing',
        weight: 1.0,
        createdAt: Date.now(),
      });

      const path = topoRepo.findShortestPath('app.local', '/home', '/billing');
      expect(path).not.toBeNull();
      expect(path?.length).toBe(3);
      expect(path?.[0].targetPath).toBe('/dashboard');
      expect(path?.[1].targetPath).toBe('/settings');
      expect(path?.[2].targetPath).toBe('/billing');
    });

    it('should query unexplored frontier nodes', () => {
      topoRepo.saveNode({
        id: 'app.local:/unexplored',
        domain: 'app.local',
        path: '/unexplored',
        pattern: '/unexplored',
        archetype: 'saas_app',
        affordances: [],
        depth: 2,
        visitedAt: 0, // Unexplored
        createdAt: Date.now(),
      });

      const frontier = topoRepo.getUnexploredFrontier('app.local', 3);
      expect(frontier.length).toBe(1);
      expect(frontier[0].path).toBe('/unexplored');
    });
  });

  describe('SiteTopologyMapper', () => {
    let mapper: SiteTopologyMapper;
    let kg: KnowledgeGraph;

    beforeEach(() => {
      const kgRepo = new KnowledgeGraphRepository(db);
      kg = new KnowledgeGraph(kgRepo, logger);
      mapper = new SiteTopologyMapper(topoRepo, kg, logger);
    });

    it('should normalize URLs into domain, clean path, and generalized pattern', () => {
      const res1 = mapper.normalizeUrl('https://STORE.LOCAL/products/999?ref=search#top');
      expect(res1.domain).toBe('store.local');
      expect(res1.path).toBe('/products/999');
      expect(res1.pattern).toBe('/products/:id');

      const res2 = mapper.normalizeUrl('https://docs.site.io/guides/getting-started/');
      expect(res2.domain).toBe('docs.site.io');
      expect(res2.path).toBe('/guides/getting-started');
      expect(res2.pattern).toBe('/guides/getting-started');
    });

    it('should extract affordances and map PageSnapshot into RouteNode', () => {
      const snapshot: PageSnapshot = {
        url: 'https://store.local/catalog',
        title: 'Product Catalog - Store Local',
        activeTabId: 'tab_001',
        compressedObservationText: 'Catalog of electronics with search and cart.',
        pageSummary: { headings: ['Catalog'], forms: [], links: [], notices: [] },
        interactiveElements: [
          {
            id: 'search_1',
            role: 'searchbox',
            name: 'Search products',
            locatorStrategy: { type: 'css', selector: '#search' },
          },
          {
            id: 'cart_1',
            role: 'button',
            name: 'View Cart',
            locatorStrategy: { type: 'css', selector: '.cart-btn' },
          },
          {
            id: 'nav_1',
            role: 'link',
            name: 'Category Laptops',
            locatorStrategy: { type: 'css', selector: 'nav.categories a' },
          },
          {
            id: 'page_next',
            role: 'link',
            name: 'Next',
            locatorStrategy: { type: 'css', selector: '.pagination a.next' },
          },
        ],
        timestamp: new Date().toISOString(),
      };

      const node = mapper.mapPage(snapshot, 1);
      expect(node.domain).toBe('store.local');
      expect(node.path).toBe('/catalog');
      expect(node.archetype).toBe('ecommerce');
      expect(node.affordances.length).toBe(4);
      expect(node.affordances.map((a) => a.type)).toEqual(
        expect.arrayContaining(['search', 'cart', 'navigation', 'pagination'])
      );

      // Verify sync with KnowledgeGraph
      const nodeInGraph = kg.getNode('domain_store_local');
      expect(nodeInGraph).toBeDefined();
    });
  });

  describe('CuriosityEngine', () => {
    it('should explore routes, observe transitions, and stop at budget limit', async () => {
      let currentPageUrl = 'https://mock.site/home';
      const mockPage = {
        goto: vi.fn().mockImplementation(async (url: string) => {
          currentPageUrl = url;
        }),
        goBack: vi.fn(),
      };

      const mockBrowserManager = {
        getPageManager: () => ({
          getActivePage: () => mockPage,
        }),
        getContext: () => ({
          newPage: async () => mockPage,
        }),
      } as any;

      const mockActionRegistry = {
        dispatch: vi.fn().mockImplementation(async () => {
          currentPageUrl = 'https://mock.site/catalog';
          return { success: true };
        }),
      } as any;

      let observationCount = 0;
      const mockPageObserver = {
        observePage: vi.fn().mockImplementation(async () => {
          observationCount++;
          const isCatalog = currentPageUrl.includes('/catalog');
          return {
            url: currentPageUrl,
            title: isCatalog ? 'Catalog' : 'Home',
            activeTabId: 'tab_001',
            compressedObservationText: isCatalog ? 'Catalog Page' : 'Home Page',
            pageSummary: { headings: [], forms: [], links: [], notices: [] },
            interactiveElements: isCatalog
              ? []
              : [
                  {
                    id: 'el_catalog_link',
                    role: 'link',
                    name: 'View Catalog',
                    locatorStrategy: { type: 'css', selector: 'a[href="/catalog"]' },
                  },
                ],
            timestamp: new Date().toISOString(),
          };
        }),
        getRegistry: () => ({
          get: () => undefined,
          resolve: () => undefined,
        }),
      } as any;

      const macroRepo = new WorkflowMacroRepository(db);
      const macroSynthesizer = new MacroSynthesizer(macroRepo, logger);

      const mapper = new SiteTopologyMapper(topoRepo, undefined, logger);
      const scorer = new CuriosityScorer();
      const actionMutex = new ActionMutex();

      const engine = new CuriosityEngine({
        browserManager: mockBrowserManager,
        actionRegistry: mockActionRegistry,
        pageObserver: mockPageObserver,
        actionMutex,
        topologyRepo: topoRepo,
        topologyMapper: mapper,
        scorer,
        macroSynthesizer,
        logger,
      });

      const report = await engine.explore('https://mock.site/home', {
        maxSteps: 5,
        maxDepth: 2,
        maxDurationMs: 5000,
        sameOriginOnly: true,
      });

      expect(report.domain).toBe('mock.site');
      expect(report.routesDiscovered).toBeGreaterThanOrEqual(1);
      expect(mockActionRegistry.dispatch).toHaveBeenCalled();
    });
  });

  describe('ReasoningStage Topology Prompt Guidance Injection', () => {
    it('should inject topology guidance into workingMemoryFacts when domain topology exists', async () => {
      // Seed topology
      topoRepo.saveNode({
        id: 'docs.io:/getting-started',
        domain: 'docs.io',
        path: '/getting-started',
        pattern: '/getting-started',
        archetype: 'documentation',
        affordances: [{ type: 'navigation', elementId: 'nav_1', name: 'Guides' }],
        depth: 1,
        visitedAt: Date.now(),
        createdAt: Date.now(),
      });

      topoRepo.saveEdge({
        id: 'docs.io:/->/getting-started',
        domain: 'docs.io',
        sourcePath: '/',
        targetPath: '/getting-started',
        transitionType: 'link_click',
        triggerSelector: 'a.start',
        weight: 1.0,
        createdAt: Date.now(),
      });

      let capturedPromptContext: any;
      const mockPromptBuilder = {
        buildMessages: vi.fn().mockImplementation((ctx) => {
          capturedPromptContext = ctx;
          return [{ role: 'user', content: 'test prompt' }];
        }),
      } as any;

      const mockLLM: LLMProvider = {
        generateDecision: vi.fn().mockResolvedValue({
          status: 'complete',
          reasoning_summary: 'Guided by topology',
          finalFindings: [],
        }),
      };

      const mockBrowserManager = {
        getTabManager: () => ({
          listTabs: () => [{ id: 'tab_001', url: 'https://docs.io/getting-started', title: 'Docs' }],
        }),
        getTabBranchManager: () => ({
          getActiveBranches: () => [],
        }),
      } as any;

      const stage = new ReasoningStage({
        browserManager: mockBrowserManager,
        promptBuilder: mockPromptBuilder,
        llmProvider: mockLLM,
        planner: { formatPlanSummary: () => 'Goal plan' } as any,
        recoveryManager: { getPromptWarnings: () => [], clear: vi.fn() } as any,
        memoryManager: { formatMemoryForPrompt: () => [] } as any,
        stateMachine: { transitionTo: vi.fn() } as any,
        logger,
        persistFindings: vi.fn(),
        recordSuccessfulPlaybook: vi.fn(),
        topologyRepo: topoRepo,
        buildResult: vi.fn().mockReturnValue({ taskId: 't1', status: 'completed', steps: 1, durationMs: 10, summary: 'done' }),
      });

      const snapshot: PageSnapshot = {
        url: 'https://docs.io/getting-started',
        title: 'Docs Getting Started',
        activeTabId: 'tab_001',
        compressedObservationText: 'Documentation text',
        pageSummary: { headings: [], forms: [], links: [], notices: [] },
        interactiveElements: [],
        timestamp: new Date().toISOString(),
      };

      await stage.execute({
        task: { id: 'task_explore', goal: 'Read getting started guide' },
        stepCount: 1,
        startTime: Date.now(),
        maxSteps: 5,
        maxDurationMs: 60000,
        sources: [],
        recentActions: [],
        plan: { goal: 'Read docs', milestones: [], currentMilestoneIndex: 0, lastUpdated: new Date().toISOString() },
        frustrationMonitor: { getFrustrationLevel: () => ({ level: 'low' }) } as any,
        processedDownloadIds: new Set(),
        currentSnapshot: snapshot,
        activePage: { url: () => 'https://docs.io/getting-started' } as any,
      });

      expect(capturedPromptContext).toBeDefined();
      const facts = capturedPromptContext?.workingMemoryFacts as string[];
      expect(facts.some((f) => f.includes('[SITE TOPOLOGY]: Known mapped routes for docs.io'))).toBe(true);
      expect(facts.some((f) => f.includes('/getting-started'))).toBe(true);
    });
  });
});

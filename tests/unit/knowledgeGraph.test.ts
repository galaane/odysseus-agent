import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteDatabase } from '../../src/persistence/Database.js';
import { KnowledgeGraphRepository } from '../../src/persistence/KnowledgeGraphRepository.js';
import { ArchetypeClassifier } from '../../src/graph/ArchetypeClassifier.js';
import { KnowledgeGraph } from '../../src/graph/KnowledgeGraph.js';
import { TransferLearner } from '../../src/graph/TransferLearner.js';
import type { PageSnapshot } from '../../src/observer/PageSnapshot.js';
import { Logger } from '../../src/logging/Logger.js';
import type { LLMProvider } from '../../src/llm/LLM.js';

describe('Phase 33: Cross-Domain Web Knowledge Graph & Semantic Transfer Learning', () => {
  let db: SqliteDatabase;
  let kgRepo: KnowledgeGraphRepository;
  let logger: Logger;

  beforeEach(() => {
    db = new SqliteDatabase({ path: ':memory:' });
    kgRepo = new KnowledgeGraphRepository(db);
    logger = new Logger('error');
  });

  afterEach(() => {
    db.close();
  });

  describe('ArchetypeClassifier', () => {
    let classifier: ArchetypeClassifier;

    beforeEach(() => {
      classifier = new ArchetypeClassifier();
    });

    it('should classify e-commerce web pages from cart cues and currency', () => {
      const snapshot: PageSnapshot = {
        url: 'https://shop.gadgets.com/products/headphones',
        title: 'Wireless Headphones - $199.99',
        activeTabId: 'tab_001',
        compressedObservationText: 'Buy now and get free shipping fee. In stock. Product details and specifications.',
        pageSummary: { headings: ['Product Details'], forms: [], links: [], notices: [] },
        interactiveElements: [
          {
            id: 'el_btn_1',
            role: 'button',
            name: 'Add to Cart',
            locatorStrategy: { type: 'css', selector: 'button.cart' },
          },
        ],
        timestamp: new Date().toISOString(),
      };

      const result = classifier.classify(snapshot);
      expect(result.archetype).toBe('ecommerce');
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
      expect(result.matchedIndicators.length).toBeGreaterThan(0);
    });

    it('should classify developer documentation pages', () => {
      const snapshot: PageSnapshot = {
        url: 'https://docs.cloudapi.io/reference/endpoints',
        title: 'API Reference & SDK Developer Guide',
        activeTabId: 'tab_001',
        compressedObservationText: 'Getting started, installation guide, and table of contents with next page button.',
        pageSummary: { headings: ['API Reference'], forms: [], links: [], notices: [] },
        interactiveElements: [
          {
            id: 'el_side_1',
            role: 'navigation',
            name: 'Sidebar topics',
            locatorStrategy: { type: 'css', selector: 'nav.sidebar' },
          },
        ],
        timestamp: new Date().toISOString(),
      };

      const result = classifier.classify(snapshot);
      expect(result.archetype).toBe('documentation');
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it('should classify code repository platforms', () => {
      const snapshot: PageSnapshot = {
        url: 'https://github.com/my-org/project/pulls',
        title: 'my-org/project: Pull requests · Commits',
        activeTabId: 'tab_001',
        compressedObservationText: 'Pull requests, branches, fork, clone repository, releases, and contributors.',
        pageSummary: { headings: ['Pull Requests'], forms: [], links: [], notices: [] },
        interactiveElements: [
          {
            id: 'el_code_1',
            role: 'button',
            name: 'Code clone',
            locatorStrategy: { type: 'css', selector: 'button.clone' },
          },
        ],
        timestamp: new Date().toISOString(),
      };

      const result = classifier.classify(snapshot);
      expect(result.archetype).toBe('code_repository');
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it('should classify authentication portals', () => {
      const snapshot: PageSnapshot = {
        url: 'https://auth.company.com/login',
        title: 'Sign In to Your Account',
        activeTabId: 'tab_001',
        compressedObservationText: 'Sign in, enter your password, forgot password, remember me, single sign-on.',
        pageSummary: { headings: ['Sign In'], forms: [], links: [], notices: [] },
        interactiveElements: [
          {
            id: 'el_auth_btn',
            role: 'button',
            name: 'Sign In',
            locatorStrategy: { type: 'css', selector: 'button.login' },
          },
        ],
        timestamp: new Date().toISOString(),
      };

      const result = classifier.classify(snapshot);
      expect(result.archetype).toBe('auth_portal');
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it('should fallback to general_web for unstructured pages', () => {
      const snapshot: PageSnapshot = {
        url: 'https://simple-site.org/info',
        title: 'Welcome',
        activeTabId: 'tab_001',
        compressedObservationText: 'Hello world',
        pageSummary: { headings: [], forms: [], links: [], notices: [] },
        interactiveElements: [],
        timestamp: new Date().toISOString(),
      };

      const result = classifier.classify(snapshot);
      expect(result.archetype).toBe('general_web');
      expect(result.confidence).toBeLessThan(0.5);
    });
  });

  describe('KnowledgeGraphRepository', () => {
    it('should save and query nodes by type', () => {
      kgRepo.saveNode({
        id: 'arch_ecommerce',
        type: 'archetype',
        name: 'ecommerce',
        properties: { category: 'retail' },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      kgRepo.saveNode({
        id: 'arch_documentation',
        type: 'archetype',
        name: 'documentation',
        properties: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const archetypes = kgRepo.getNodesByType('archetype');
      expect(archetypes.length).toBe(2);
      expect(archetypes.map((a) => a.name)).toContain('ecommerce');
      expect(archetypes.map((a) => a.name)).toContain('documentation');
    });

    it('should save edges and query inbound/outbound relationships', () => {
      kgRepo.saveEdge({
        id: 'edge_1',
        sourceId: 'domain_shop_com',
        targetId: 'arch_ecommerce',
        relation: 'belongs_to_archetype',
        weight: 0.9,
        sampleCount: 5,
        updatedAt: new Date().toISOString(),
      });

      const outbound = kgRepo.getOutboundEdges('domain_shop_com');
      expect(outbound.length).toBe(1);
      expect(outbound[0].targetId).toBe('arch_ecommerce');
      expect(outbound[0].relation).toBe('belongs_to_archetype');

      const inbound = kgRepo.getInboundEdges('arch_ecommerce');
      expect(inbound.length).toBe(1);
      expect(inbound[0].sourceId).toBe('domain_shop_com');
    });

    it('should asymptotically reinforce edge weights on success and penalize on failure', () => {
      kgRepo.saveEdge({
        id: 'edge_test',
        sourceId: 'arch_ecommerce',
        targetId: 'concept_add_to_cart',
        relation: 'uses_concept',
        weight: 0.5,
        sampleCount: 1,
        updatedAt: new Date().toISOString(),
      });

      // Positive reinforcement
      kgRepo.reinforceEdge('arch_ecommerce', 'concept_add_to_cart', 'uses_concept', true);
      let edge = kgRepo.getEdge('arch_ecommerce', 'concept_add_to_cart', 'uses_concept');
      expect(edge?.weight).toBeGreaterThan(0.5);
      expect(edge?.sampleCount).toBe(2);

      // Negative penalty
      const priorWeight = edge!.weight;
      kgRepo.reinforceEdge('arch_ecommerce', 'concept_add_to_cart', 'uses_concept', false);
      edge = kgRepo.getEdge('arch_ecommerce', 'concept_add_to_cart', 'uses_concept');
      expect(edge?.weight).toBeLessThan(priorWeight);
      expect(edge?.sampleCount).toBe(3);
    });
  });

  describe('KnowledgeGraph', () => {
    it('should initialize with default pre-seeded archetypes and concepts', () => {
      const graph = new KnowledgeGraph(kgRepo, logger);
      expect(graph.getNodeCount()).toBeGreaterThan(10);

      const ecommerceConcepts = graph.getArchetypeConcepts('ecommerce');
      expect(ecommerceConcepts.length).toBeGreaterThanOrEqual(3);
      expect(ecommerceConcepts.some((c) => c.name === 'AddToCartButton')).toBe(true);
      expect(ecommerceConcepts.some((c) => c.name === 'ProductSearch')).toBe(true);

      const docsConcepts = graph.getArchetypeConcepts('documentation');
      expect(docsConcepts.some((c) => c.name === 'SidebarNavigation')).toBe(true);
    });

    it('should associate domain to archetype and retrieve mapped concept strategies', () => {
      const graph = new KnowledgeGraph(kgRepo, logger);
      graph.associateDomain('boutique.store', 'ecommerce', 0.95);

      const mapped = graph.getDomainArchetype('boutique.store');
      expect(mapped).not.toBeNull();
      expect(mapped?.archetype).toBe('ecommerce');
      expect(mapped?.confidence).toBe(0.95);

      const concepts = graph.getArchetypeConcepts(mapped!.archetype);
      expect(concepts[0].archetype).toBe('ecommerce');
      expect(concepts[0].typicalRoles.length).toBeGreaterThan(0);
    });

    it('should reinforce concept reliability in-memory and in repository', () => {
      const graph = new KnowledgeGraph(kgRepo, logger);
      const initialConcepts = graph.getArchetypeConcepts('ecommerce');
      const searchConcept = initialConcepts.find((c) => c.name === 'ProductSearch')!;
      const initialWeight = searchConcept.reliability;

      graph.reinforceConcept('ecommerce', 'ProductSearch', true);
      const updatedConcepts = graph.getArchetypeConcepts('ecommerce');
      const updatedSearch = updatedConcepts.find((c) => c.name === 'ProductSearch')!;
      expect(updatedSearch.reliability).toBeGreaterThan(initialWeight);
    });
  });

  describe('TransferLearner', () => {
    it('should generate cross-domain transfer recommendations for unfamiliar domain', () => {
      const graph = new KnowledgeGraph(kgRepo, logger);
      const learner = new TransferLearner({ knowledgeGraph: graph, logger });

      const snapshot: PageSnapshot = {
        url: 'https://newmarket.xyz/items/shoe-01',
        title: 'Sports Shoes - $79',
        activeTabId: 'tab_001',
        compressedObservationText: 'Buy now and add to cart. Product details and shipping.',
        pageSummary: { headings: [], forms: [], links: [], notices: [] },
        interactiveElements: [
          {
            id: 'btn_add',
            role: 'button',
            name: 'Add to Cart',
            locatorStrategy: { type: 'css', selector: '#add' },
          },
        ],
        timestamp: new Date().toISOString(),
      };

      const rec = learner.getRecommendationsForPage('newmarket.xyz', snapshot);
      expect(rec.domain).toBe('newmarket.xyz');
      expect(rec.archetype).toBe('ecommerce');
      expect(rec.matchedConcepts.length).toBeGreaterThanOrEqual(2);
      expect(rec.promptSummary).toContain('CROSS-DOMAIN TRANSFER HEURISTIC (ECOMMERCE');
      expect(rec.promptSummary).toContain('AddToCartButton');
      expect(rec.recommendedStrategies.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('ReasoningStage Cross-Domain Knowledge Transfer Integration', () => {
    it('should inject archetype heuristics into prompt context when domain playbooks are sparse', async () => {
      const { ReasoningStage } = await import('../../src/agent/pipeline/ReasoningStage.js');
      const graph = new KnowledgeGraph(kgRepo, logger);
      const transferLearner = new TransferLearner({ knowledgeGraph: graph, logger });

      let capturedPromptContext: Record<string, unknown> | undefined;

      const mockPromptBuilder = {
        buildMessages: vi.fn().mockImplementation((context) => {
          capturedPromptContext = context;
          return [{ role: 'user', content: 'test prompt' }];
        }),
      } as any;

      const mockLLM: LLMProvider = {
        generateDecision: vi.fn().mockResolvedValue({
          status: 'complete',
          reasoning_summary: 'Target found using cross-domain e-commerce pattern.',
          finalFindings: [],
        }),
      };

      const mockBrowserManager = {
        getTabManager: () => ({
          listTabs: () => [{ id: 'tab_001', url: 'https://fresh-shop.com', title: 'Fresh Shop' }],
        }),
        getTabBranchManager: () => ({
          getActiveBranches: () => [],
        }),
      } as any;

      const mockPage = {
        url: () => 'https://fresh-shop.com/products/item',
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
        transferLearner,
        buildResult: vi.fn().mockReturnValue({ taskId: 't1', status: 'completed', steps: 1, durationMs: 10, summary: 'done' }),
      });

      const snapshot: PageSnapshot = {
        url: 'https://fresh-shop.com/products/item',
        title: 'Organic Tea - $12.50',
        activeTabId: 'tab_001',
        compressedObservationText: 'Buy now and add to cart. Product details.',
        pageSummary: { headings: [], forms: [], links: [], notices: [] },
        interactiveElements: [
          {
            id: 'btn_cart',
            role: 'button',
            name: 'Add to Cart',
            locatorStrategy: { type: 'css', selector: '.cart' },
          },
        ],
        timestamp: new Date().toISOString(),
      };

      await stage.execute({
        task: { id: 'task_cd', goal: 'Find price of organic tea' },
        stepCount: 1,
        startTime: Date.now(),
        maxSteps: 5,
        maxDurationMs: 60000,
        sources: [],
        recentActions: [],
        plan: { goal: 'Find price', milestones: [], currentMilestoneIndex: 0, lastUpdated: new Date().toISOString() },
        frustrationMonitor: { getFrustrationLevel: () => ({ level: 'low' }) } as any,
        processedDownloadIds: new Set(),
        currentSnapshot: snapshot,
        activePage: mockPage,
      });

      expect(capturedPromptContext).toBeDefined();
      const facts = capturedPromptContext?.workingMemoryFacts as string[];
      expect(facts.some((f) => f.includes('CROSS-DOMAIN TRANSFER HEURISTIC (ECOMMERCE'))).toBe(true);
      expect(facts.some((f) => f.includes('AddToCartButton'))).toBe(true);
    });
  });
});

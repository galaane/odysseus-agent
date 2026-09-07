import type { KnowledgeGraphRepository } from '../persistence/KnowledgeGraphRepository.js';
import type {
  GraphNode,
  GraphEdge,
  DomainArchetype,
  TransferableConcept,
  EdgeRelation,
} from './types.js';
import type { Logger } from '../logging/Logger.js';

export const DEFAULT_ARCHETYPE_CONCEPTS: Record<DomainArchetype, TransferableConcept[]> = {
  ecommerce: [
    {
      name: 'AddToCartButton',
      archetype: 'ecommerce',
      typicalRoles: ['button'],
      typicalNamePatterns: ['add to cart', 'buy now', 'order'],
      strategyHint: 'Select quantity/variant first before clicking Add to Cart.',
      reliability: 0.95,
    },
    {
      name: 'ProductSearch',
      archetype: 'ecommerce',
      typicalRoles: ['searchbox', 'textbox'],
      typicalNamePatterns: ['search', 'find products', 'keywords'],
      strategyHint: 'Enter product query and click search or press Enter to load catalog grid.',
      reliability: 0.90,
    },
    {
      name: 'CartCheckout',
      archetype: 'ecommerce',
      typicalRoles: ['button', 'link'],
      typicalNamePatterns: ['checkout', 'view cart', 'proceed to checkout'],
      strategyHint: 'Check cart overlay or drawer for order summary before proceeding to checkout form.',
      reliability: 0.92,
    },
    {
      name: 'PaginationControl',
      archetype: 'ecommerce',
      typicalRoles: ['navigation', 'button', 'link'],
      typicalNamePatterns: ['next', 'page', 'load more', 'show more'],
      strategyHint: 'Inspect footer or bottom of product grid for next page button or infinite scroll.',
      reliability: 0.85,
    },
  ],
  documentation: [
    {
      name: 'SidebarNavigation',
      archetype: 'documentation',
      typicalRoles: ['navigation', 'link'],
      typicalNamePatterns: ['sidebar', 'table of contents', 'topics', 'overview'],
      strategyHint: 'Use hierarchical sidebar to jump directly to target API or section.',
      reliability: 0.95,
    },
    {
      name: 'DocSearchModal',
      archetype: 'documentation',
      typicalRoles: ['searchbox', 'button'],
      typicalNamePatterns: ['search documentation', 'quick search', 'find in docs'],
      strategyHint: 'Click search input or press Ctrl/Cmd+K to trigger full-text documentation modal.',
      reliability: 0.92,
    },
    {
      name: 'VersionSelector',
      archetype: 'documentation',
      typicalRoles: ['combobox', 'button'],
      typicalNamePatterns: ['version', 'latest', 'v1', 'v2'],
      strategyHint: 'Verify that the documentation version selector matches target framework release.',
      reliability: 0.80,
    },
  ],
  code_repository: [
    {
      name: 'BranchSelector',
      archetype: 'code_repository',
      typicalRoles: ['button', 'combobox'],
      typicalNamePatterns: ['branch', 'main', 'master', 'tag'],
      strategyHint: 'Switch Git ref before searching file tree or reading code blobs.',
      reliability: 0.92,
    },
    {
      name: 'CodeFileTree',
      archetype: 'code_repository',
      typicalRoles: ['table', 'tree', 'link'],
      typicalNamePatterns: ['src', 'test', 'packages', 'readme'],
      strategyHint: 'Navigate repository folder structures sequentially through directory links.',
      reliability: 0.90,
    },
    {
      name: 'PullRequestTabs',
      archetype: 'code_repository',
      typicalRoles: ['tab', 'link'],
      typicalNamePatterns: ['conversation', 'commits', 'checks', 'files changed'],
      strategyHint: 'Use Files Changed tab to inspect diffs and Checks tab for CI/CD status.',
      reliability: 0.95,
    },
  ],
  saas_app: [
    {
      name: 'WorkspaceNavigation',
      archetype: 'saas_app',
      typicalRoles: ['navigation', 'link'],
      typicalNamePatterns: ['dashboard', 'projects', 'workspace', 'analytics', 'settings'],
      strategyHint: 'Use left sidebar or header bar to locate desired application sub-module.',
      reliability: 0.90,
    },
    {
      name: 'UserAvatarMenu',
      archetype: 'saas_app',
      typicalRoles: ['button', 'menuitem'],
      typicalNamePatterns: ['profile', 'account', 'settings', 'organization', 'sign out'],
      strategyHint: 'Access workspace settings, API keys, and logout via top-right avatar menu.',
      reliability: 0.88,
    },
  ],
  auth_portal: [
    {
      name: 'LoginForm',
      archetype: 'auth_portal',
      typicalRoles: ['textbox', 'button'],
      typicalNamePatterns: ['email', 'username', 'password', 'sign in', 'log in'],
      strategyHint: 'Fill identifier first, then password; monitor for subsequent MFA or OTP challenges.',
      reliability: 0.95,
    },
  ],
  content_blog: [
    {
      name: 'ArticleContent',
      archetype: 'content_blog',
      typicalRoles: ['article', 'main'],
      typicalNamePatterns: ['read time', 'published on', 'author', 'share'],
      strategyHint: 'Focus observation on main article container, ignoring side banners and related links.',
      reliability: 0.88,
    },
  ],
  general_web: [
    {
      name: 'PrimaryNavigation',
      archetype: 'general_web',
      typicalRoles: ['navigation', 'link'],
      typicalNamePatterns: ['home', 'about', 'contact', 'services'],
      strategyHint: 'Use top navigation header to discover core website destinations.',
      reliability: 0.80,
    },
  ],
};

export class KnowledgeGraph {
  private nodes = new Map<string, GraphNode>();
  private outEdges = new Map<string, GraphEdge[]>();
  private inEdges = new Map<string, GraphEdge[]>();

  constructor(
    private readonly repo?: KnowledgeGraphRepository,
    private readonly logger?: Logger
  ) {
    this.seedDefaultGraph();
  }

  /**
   * Initializes standard archetype nodes and canonical affordances.
   */
  private seedDefaultGraph(): void {
    const now = new Date().toISOString();

    for (const [archetypeKey, concepts] of Object.entries(DEFAULT_ARCHETYPE_CONCEPTS) as [
      DomainArchetype,
      TransferableConcept[],
    ][]) {
      const archNodeId = `arch_${archetypeKey}`;
      const archNode: GraphNode = {
        id: archNodeId,
        type: 'archetype',
        name: archetypeKey,
        properties: {},
        createdAt: now,
        updatedAt: now,
      };

      this.addNode(archNode);

      for (const concept of concepts) {
        const conceptNodeId = `concept_${archetypeKey}_${concept.name}`;
        const conceptNode: GraphNode = {
          id: conceptNodeId,
          type: 'concept',
          name: concept.name,
          properties: {
            archetype: concept.archetype,
            typicalRoles: concept.typicalRoles,
            typicalNamePatterns: concept.typicalNamePatterns,
            strategyHint: concept.strategyHint,
          },
          createdAt: now,
          updatedAt: now,
        };

        this.addNode(conceptNode);

        const edge: GraphEdge = {
          id: `edge_${archNodeId}_${conceptNodeId}_uses`,
          sourceId: archNodeId,
          targetId: conceptNodeId,
          relation: 'uses_concept',
          weight: concept.reliability,
          sampleCount: 10,
          updatedAt: now,
        };

        this.addEdge(edge);
      }
    }
  }

  public addNode(node: GraphNode): void {
    this.nodes.set(node.id, node);
    if (this.repo) {
      try {
        this.repo.saveNode(node);
      } catch (err) {
        this.logger?.warn('KnowledgeGraph', `Failed to persist node ${node.id}: ${String(err)}`);
      }
    }
  }

  public getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id) || (this.repo ? this.repo.getNode(id) || undefined : undefined);
  }

  public addEdge(edge: GraphEdge): void {
    const outList = this.outEdges.get(edge.sourceId) || [];
    const filteredOut = outList.filter(
      (e) => !(e.targetId === edge.targetId && e.relation === edge.relation)
    );
    filteredOut.push(edge);
    this.outEdges.set(edge.sourceId, filteredOut);

    const inList = this.inEdges.get(edge.targetId) || [];
    const filteredIn = inList.filter(
      (e) => !(e.sourceId === edge.sourceId && e.relation === edge.relation)
    );
    filteredIn.push(edge);
    this.inEdges.set(edge.targetId, filteredIn);

    if (this.repo) {
      try {
        this.repo.saveEdge(edge);
      } catch (err) {
        this.logger?.warn('KnowledgeGraph', `Failed to persist edge ${edge.id}: ${String(err)}`);
      }
    }
  }

  /**
   * Associates a website domain with a classified Domain Archetype.
   */
  public associateDomain(domain: string, archetype: DomainArchetype, confidence: number): void {
    const cleanDomain = domain.toLowerCase().trim();
    const domainNodeId = `domain_${cleanDomain.replace(/[^a-z0-9]/g, '_')}`;
    const archNodeId = `arch_${archetype}`;
    const now = new Date().toISOString();

    const domainNode: GraphNode = {
      id: domainNodeId,
      type: 'domain',
      name: cleanDomain,
      properties: { archetype },
      createdAt: now,
      updatedAt: now,
    };

    this.addNode(domainNode);

    const edge: GraphEdge = {
      id: `edge_${domainNodeId}_${archNodeId}_belongs`,
      sourceId: domainNodeId,
      targetId: archNodeId,
      relation: 'belongs_to_archetype',
      weight: confidence,
      sampleCount: 1,
      updatedAt: now,
    };

    this.addEdge(edge);

    this.logger?.info(
      'KnowledgeGraph',
      `Associated domain [${cleanDomain}] with archetype [${archetype}] (confidence: ${confidence})`
    );
  }

  /**
   * Retrieves the linked archetype for a domain if previously mapped.
   */
  public getDomainArchetype(domain: string): { archetype: DomainArchetype; confidence: number } | null {
    const cleanDomain = domain.toLowerCase().trim();
    const domainNodeId = `domain_${cleanDomain.replace(/[^a-z0-9]/g, '_')}`;
    const outList = this.outEdges.get(domainNodeId) || (this.repo ? this.repo.getOutboundEdges(domainNodeId) : []);

    const edge = outList.find((e) => e.relation === 'belongs_to_archetype');
    if (edge && edge.targetId.startsWith('arch_')) {
      const archName = edge.targetId.replace('arch_', '') as DomainArchetype;
      return { archetype: archName, confidence: edge.weight };
    }

    return null;
  }

  /**
   * Retrieves active transferable concepts for a given archetype, ordered by reliability weight.
   */
  public getArchetypeConcepts(archetype: DomainArchetype): TransferableConcept[] {
    const archNodeId = `arch_${archetype}`;
    const outList = this.outEdges.get(archNodeId) || (this.repo ? this.repo.getOutboundEdges(archNodeId) : []);

    const concepts: TransferableConcept[] = [];

    for (const edge of outList.filter((e) => e.relation === 'uses_concept')) {
      const node = this.getNode(edge.targetId);
      if (node && node.properties) {
        concepts.push({
          name: node.name,
          archetype,
          typicalRoles: (node.properties.typicalRoles as string[]) || [],
          typicalNamePatterns: (node.properties.typicalNamePatterns as string[]) || [],
          strategyHint: (node.properties.strategyHint as string) || '',
          reliability: edge.weight,
        });
      }
    }

    // Sort descending by empirical reliability
    return concepts.sort((a, b) => b.reliability - a.reliability);
  }

  /**
   * Reinforces or penalizes the empirical reliability of an archetype concept based on action outcome.
   */
  public reinforceConcept(archetype: DomainArchetype, conceptName: string, success: boolean): void {
    const archNodeId = `arch_${archetype}`;
    const conceptNodeId = `concept_${archetype}_${conceptName}`;

    if (this.repo) {
      this.repo.reinforceEdge(archNodeId, conceptNodeId, 'uses_concept', success);
      const updated = this.repo.getEdge(archNodeId, conceptNodeId, 'uses_concept');
      if (updated) {
        this.addEdge(updated);
      }
    } else {
      const outList = this.outEdges.get(archNodeId) || [];
      const edge = outList.find((e) => e.targetId === conceptNodeId && e.relation === 'uses_concept');
      if (edge) {
        edge.weight = success
          ? Math.min(1.0, edge.weight + 0.1 * (1.0 - edge.weight))
          : Math.max(0.05, edge.weight - 0.15 * edge.weight);
        edge.sampleCount += 1;
        edge.updatedAt = new Date().toISOString();
      }
    }
  }

  public getNodeCount(): number {
    return this.nodes.size;
  }

  public getAllNodes(): GraphNode[] {
    return Array.from(this.nodes.values());
  }

  public getAllEdges(): GraphEdge[] {
    const edges: GraphEdge[] = [];
    for (const list of this.outEdges.values()) {
      edges.push(...list);
    }
    return edges;
  }
}

import type { PageSnapshot } from '../observer/PageSnapshot.js';
import type { RegisteredElement } from '../observer/ElementRegistry.js';
import type { RouteNode, RouteEdge, RouteAffordance, TransitionType } from './types.js';
import type { TopologyRepository } from '../persistence/TopologyRepository.js';
import { ArchetypeClassifier } from '../graph/ArchetypeClassifier.js';
import type { KnowledgeGraph } from '../graph/KnowledgeGraph.js';
import type { Logger } from '../logging/Logger.js';

export class SiteTopologyMapper {
  private readonly classifier: ArchetypeClassifier;

  constructor(
    private readonly repo: TopologyRepository,
    private readonly knowledgeGraph?: KnowledgeGraph,
    private readonly logger?: Logger
  ) {
    this.classifier = new ArchetypeClassifier();
  }

  public mapPage(snapshot: PageSnapshot, currentDepth: number = 0): RouteNode {
    const { domain, path, pattern } = this.normalizeUrl(snapshot.url);
    const classification = this.classifier.classify(snapshot);

    // Extract affordances from snapshot elements
    const affordances = this.extractAffordances(snapshot.interactiveElements || []);

    const now = Date.now();
    const existing = this.repo.getNode(domain, path);

    const node: RouteNode = {
      id: `${domain}:${path}`,
      domain,
      path,
      pattern,
      title: snapshot.title || existing?.title || undefined,
      archetype: classification.archetype,
      affordances,
      depth: existing ? Math.min(existing.depth, currentDepth) : currentDepth,
      visitedAt: now,
      createdAt: existing?.createdAt || now,
    };

    this.repo.saveNode(node);

    // Optionally sync archetype to KnowledgeGraph
    if (this.knowledgeGraph) {
      this.knowledgeGraph.associateDomain(domain, classification.archetype, classification.confidence);
    }

    this.logger?.info(
      'SiteTopologyMapper',
      `Mapped route [${path}] on domain [${domain}] (archetype: ${classification.archetype}, affordances: ${affordances.length})`
    );

    return node;
  }

  public recordTransition(params: {
    domain: string;
    sourcePath: string;
    targetPath: string;
    transitionType: TransitionType;
    triggerSelector: string;
    triggerRole?: string;
    triggerName?: string;
  }): RouteEdge {
    const edgeId = `${params.domain}:${params.sourcePath}->${params.targetPath}`;
    const now = Date.now();

    const edge: RouteEdge = {
      id: edgeId,
      domain: params.domain,
      sourcePath: params.sourcePath,
      targetPath: params.targetPath,
      transitionType: params.transitionType,
      triggerSelector: params.triggerSelector,
      triggerRole: params.triggerRole,
      triggerName: params.triggerName,
      weight: 1.0,
      createdAt: now,
    };

    this.repo.saveEdge(edge);

    this.logger?.debug(
      'SiteTopologyMapper',
      `Recorded topology transition [${params.sourcePath} -> ${params.targetPath}] via ${params.transitionType}`
    );

    return edge;
  }

  public normalizeUrl(rawUrl: string): { domain: string; path: string; pattern: string } {
    try {
      const parsed = new URL(rawUrl);
      const domain = parsed.hostname.toLowerCase();
      let path = parsed.pathname || '/';

      if (!path.startsWith('/')) {
        path = `/${path}`;
      }
      if (path.length > 1 && path.endsWith('/')) {
        path = path.slice(0, -1);
      }

      // Compute generalized pattern (e.g. /products/123 -> /products/:id)
      const pattern = path
        .replace(/\/[0-9]+(?=\/|$)/g, '/:id')
        .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/:uuid');

      return { domain, path, pattern };
    } catch {
      return { domain: 'unknown', path: '/', pattern: '/' };
    }
  }

  private extractAffordances(elements: RegisteredElement[]): RouteAffordance[] {
    const affordances: RouteAffordance[] = [];
    const seen = new Set<string>();

    for (const el of elements) {
      const role = el.role.toLowerCase();
      const name = (el.name || '').toLowerCase();
      const selector = el.locatorStrategy.selector.toLowerCase();

      // Search affordance
      if (
        (role === 'searchbox' || role === 'textbox') &&
        (name.includes('search') || selector.includes('search') || selector.includes('query'))
      ) {
        const key = `search_${el.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          affordances.push({
            type: 'search',
            elementId: el.id,
            role: el.role,
            name: el.name,
            selector: el.locatorStrategy.selector,
          });
        }
      }

      // Auth affordance
      if (
        (role === 'button' || role === 'link') &&
        (name.includes('login') ||
          name.includes('sign in') ||
          name.includes('register') ||
          name.includes('sign up'))
      ) {
        const key = `auth_${el.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          affordances.push({
            type: 'auth',
            elementId: el.id,
            role: el.role,
            name: el.name,
            selector: el.locatorStrategy.selector,
          });
        }
      }

      // Cart affordance
      if (
        (role === 'button' || role === 'link') &&
        (name.includes('cart') || name.includes('checkout') || name.includes('add to cart'))
      ) {
        const key = `cart_${el.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          affordances.push({
            type: 'cart',
            elementId: el.id,
            role: el.role,
            name: el.name,
            selector: el.locatorStrategy.selector,
          });
        }
      }

      // Pagination affordance
      if (
        (role === 'button' || role === 'link') &&
        (name === 'next' || name === 'previous' || name.includes('page') || selector.includes('pagination'))
      ) {
        const key = `pagination_${el.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          affordances.push({
            type: 'pagination',
            elementId: el.id,
            role: el.role,
            name: el.name,
            selector: el.locatorStrategy.selector,
          });
        }
      }

      // Table affordance
      if (role === 'table' || role === 'grid') {
        const key = `table_${el.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          affordances.push({
            type: 'table',
            elementId: el.id,
            role: el.role,
            name: el.name,
            selector: el.locatorStrategy.selector,
          });
        }
      }

      // Navigation menu affordance
      if (role === 'navigation' || (role === 'link' && selector.includes('nav'))) {
        const key = `nav_${el.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          affordances.push({
            type: 'navigation',
            elementId: el.id,
            role: el.role,
            name: el.name,
            selector: el.locatorStrategy.selector,
          });
        }
      }
    }

    return affordances;
  }
}

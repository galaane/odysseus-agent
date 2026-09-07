import type { SqliteDatabase } from './Database.js';
import type { RouteNode, RouteEdge, SiteTopology, RouteAffordance, TransitionType } from '../exploration/types.js';
import type { DomainArchetype } from '../graph/types.js';

interface RawTopologyNodeRow {
  id: string;
  domain: string;
  path: string;
  pattern: string;
  title: string | null;
  archetype: string;
  affordances: string;
  depth: number;
  visited_at: number;
  created_at: number;
}

interface RawTopologyEdgeRow {
  id: string;
  domain: string;
  source_path: string;
  target_path: string;
  transition_type: string;
  trigger_selector: string;
  trigger_role: string | null;
  trigger_name: string | null;
  weight: number;
  created_at: number;
}

export class TopologyRepository {
  constructor(private readonly db: SqliteDatabase) {}

  public saveNode(node: RouteNode): void {
    const stmt = this.db.prepare(`
      INSERT INTO site_topology_nodes (
        id, domain, path, pattern, title, archetype, affordances, depth, visited_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(domain, path) DO UPDATE SET
        pattern = excluded.pattern,
        title = excluded.title,
        archetype = excluded.archetype,
        affordances = excluded.affordances,
        depth = excluded.depth,
        visited_at = excluded.visited_at
    `);

    stmt.run(
      node.id,
      node.domain,
      node.path,
      node.pattern,
      node.title || null,
      node.archetype,
      JSON.stringify(node.affordances),
      node.depth,
      node.visitedAt,
      node.createdAt
    );
  }

  public getNode(domain: string, path: string): RouteNode | null {
    const stmt = this.db.prepare(`
      SELECT * FROM site_topology_nodes WHERE domain = ? AND path = ?
    `);
    const row = stmt.get(domain, path) as unknown as RawTopologyNodeRow | undefined;
    return row ? this.mapNodeRow(row) : null;
  }

  public getNodesByDomain(domain: string): RouteNode[] {
    const stmt = this.db.prepare(`
      SELECT * FROM site_topology_nodes WHERE domain = ? ORDER BY depth ASC, visited_at DESC
    `);
    const rows = stmt.all(domain) as unknown as RawTopologyNodeRow[];
    return rows.map((r) => this.mapNodeRow(r));
  }

  public saveEdge(edge: RouteEdge): void {
    const stmt = this.db.prepare(`
      INSERT INTO site_topology_edges (
        id, domain, source_path, target_path, transition_type, trigger_selector, trigger_role, trigger_name, weight, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        transition_type = excluded.transition_type,
        trigger_selector = excluded.trigger_selector,
        trigger_role = excluded.trigger_role,
        trigger_name = excluded.trigger_name,
        weight = excluded.weight
    `);

    stmt.run(
      edge.id,
      edge.domain,
      edge.sourcePath,
      edge.targetPath,
      edge.transitionType,
      edge.triggerSelector,
      edge.triggerRole || null,
      edge.triggerName || null,
      edge.weight,
      edge.createdAt
    );
  }

  public getEdgesByDomain(domain: string): RouteEdge[] {
    const stmt = this.db.prepare(`
      SELECT * FROM site_topology_edges WHERE domain = ? ORDER BY weight DESC
    `);
    const rows = stmt.all(domain) as unknown as RawTopologyEdgeRow[];
    return rows.map((r) => this.mapEdgeRow(r));
  }

  public getEdgesFrom(domain: string, sourcePath: string): RouteEdge[] {
    const stmt = this.db.prepare(`
      SELECT * FROM site_topology_edges WHERE domain = ? AND source_path = ? ORDER BY weight DESC
    `);
    const rows = stmt.all(domain, sourcePath) as unknown as RawTopologyEdgeRow[];
    return rows.map((r) => this.mapEdgeRow(r));
  }

  public getTopology(domain: string, rootUrl: string = `https://${domain}`): SiteTopology {
    const nodesList = this.getNodesByDomain(domain);
    const edges = this.getEdgesByDomain(domain);

    const nodes = new Map<string, RouteNode>();
    for (const node of nodesList) {
      nodes.set(node.path, node);
    }

    const coverageScore = nodes.size > 0 ? Math.min(1.0, nodes.size / 20) : 0;

    return {
      domain,
      rootUrl,
      nodes,
      edges,
      coverageScore,
    };
  }

  public getAllDomains(): string[] {
    const stmt = this.db.prepare('SELECT DISTINCT domain FROM site_topology_nodes ORDER BY domain ASC');
    const rows = stmt.all() as Array<{ domain: string }>;
    return rows.map((r) => r.domain);
  }

  public getAllNodes(): RouteNode[] {
    const stmt = this.db.prepare('SELECT * FROM site_topology_nodes ORDER BY domain ASC, depth ASC');
    const rows = stmt.all() as unknown as RawTopologyNodeRow[];
    return rows.map((r) => this.mapNodeRow(r));
  }

  public getAllEdges(): RouteEdge[] {
    const stmt = this.db.prepare('SELECT * FROM site_topology_edges ORDER BY domain ASC, weight DESC');
    const rows = stmt.all() as unknown as RawTopologyEdgeRow[];
    return rows.map((r) => this.mapEdgeRow(r));
  }


  public findShortestPath(domain: string, fromPath: string, toTargetPath: string): RouteEdge[] | null {
    if (fromPath === toTargetPath) return [];

    const edges = this.getEdgesByDomain(domain);
    const adj = new Map<string, RouteEdge[]>();

    for (const edge of edges) {
      const list = adj.get(edge.sourcePath) || [];
      list.push(edge);
      adj.set(edge.sourcePath, list);
    }

    // BFS queue: [currentPath, pathOfEdges]
    const queue: Array<{ current: string; path: RouteEdge[] }> = [{ current: fromPath, path: [] }];
    const visited = new Set<string>([fromPath]);

    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;

      const { current, path } = item;
      if (current === toTargetPath) {
        return path;
      }

      const neighbors = adj.get(current) || [];
      for (const edge of neighbors) {
        if (!visited.has(edge.targetPath)) {
          visited.add(edge.targetPath);
          queue.push({
            current: edge.targetPath,
            path: [...path, edge],
          });
        }
      }
    }

    return null;
  }

  public getUnexploredFrontier(domain: string, maxDepth: number = 3): RouteNode[] {
    const stmt = this.db.prepare(`
      SELECT * FROM site_topology_nodes
      WHERE domain = ? AND depth <= ? AND visited_at = 0
      ORDER BY depth ASC, created_at ASC
    `);
    const rows = stmt.all(domain, maxDepth) as unknown as RawTopologyNodeRow[];
    return rows.map((r) => this.mapNodeRow(r));
  }

  public clearTopology(domain: string): void {
    this.db.prepare('DELETE FROM site_topology_nodes WHERE domain = ?').run(domain);
    this.db.prepare('DELETE FROM site_topology_edges WHERE domain = ?').run(domain);
  }

  private mapNodeRow(row: RawTopologyNodeRow): RouteNode {
    let affordances: RouteAffordance[] = [];
    try {
      affordances = JSON.parse(row.affordances) as RouteAffordance[];
    } catch {
      affordances = [];
    }

    return {
      id: row.id,
      domain: row.domain,
      path: row.path,
      pattern: row.pattern,
      title: row.title || undefined,
      archetype: row.archetype as DomainArchetype,
      affordances,
      depth: row.depth,
      visitedAt: row.visited_at,
      createdAt: row.created_at,
    };
  }

  private mapEdgeRow(row: RawTopologyEdgeRow): RouteEdge {
    return {
      id: row.id,
      domain: row.domain,
      sourcePath: row.source_path,
      targetPath: row.target_path,
      transitionType: row.transition_type as TransitionType,
      triggerSelector: row.trigger_selector,
      triggerRole: row.trigger_role || undefined,
      triggerName: row.trigger_name || undefined,
      weight: row.weight,
      createdAt: row.created_at,
    };
  }
}

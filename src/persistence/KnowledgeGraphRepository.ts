import type { SqliteDatabase } from './Database.js';
import type { GraphNode, GraphEdge, NodeType, EdgeRelation } from '../graph/types.js';

interface RawNodeRow {
  id: string;
  type: string;
  name: string;
  properties: string;
  created_at: string;
  updated_at: string;
}

interface RawEdgeRow {
  id: string;
  source_id: string;
  target_id: string;
  relation: string;
  weight: number;
  sample_count: number;
  metadata: string;
  updated_at: string;
}

export class KnowledgeGraphRepository {
  constructor(private readonly db: SqliteDatabase) {}

  public saveNode(node: GraphNode): void {
    const stmt = this.db.prepare(`
      INSERT INTO kg_nodes (id, type, name, properties, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        name = excluded.name,
        properties = excluded.properties,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      node.id,
      node.type,
      node.name,
      JSON.stringify(node.properties || {}),
      node.createdAt,
      node.updatedAt
    );
  }

  public getNode(id: string): GraphNode | null {
    const stmt = this.db.prepare('SELECT * FROM kg_nodes WHERE id = ?');
    const row = stmt.get(id) as unknown as RawNodeRow | undefined;
    return row ? this.mapNodeRow(row) : null;
  }

  public getNodesByType(type: NodeType): GraphNode[] {
    const stmt = this.db.prepare('SELECT * FROM kg_nodes WHERE type = ? ORDER BY name ASC');
    const rows = stmt.all(type) as unknown as RawNodeRow[];
    return rows.map((r) => this.mapNodeRow(r));
  }

  public saveEdge(edge: GraphEdge): void {
    const stmt = this.db.prepare(`
      INSERT INTO kg_edges (id, source_id, target_id, relation, weight, sample_count, metadata, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id, target_id, relation) DO UPDATE SET
        weight = excluded.weight,
        sample_count = excluded.sample_count,
        metadata = excluded.metadata,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      edge.id,
      edge.sourceId,
      edge.targetId,
      edge.relation,
      edge.weight,
      edge.sampleCount,
      JSON.stringify(edge.metadata || {}),
      edge.updatedAt
    );
  }

  public getEdge(sourceId: string, targetId: string, relation: EdgeRelation): GraphEdge | null {
    const stmt = this.db.prepare(`
      SELECT * FROM kg_edges
      WHERE source_id = ? AND target_id = ? AND relation = ?
    `);
    const row = stmt.get(sourceId, targetId, relation) as unknown as RawEdgeRow | undefined;
    return row ? this.mapEdgeRow(row) : null;
  }

  public getOutboundEdges(sourceId: string): GraphEdge[] {
    const stmt = this.db.prepare(`
      SELECT * FROM kg_edges
      WHERE source_id = ?
      ORDER BY weight DESC
    `);
    const rows = stmt.all(sourceId) as unknown as RawEdgeRow[];
    return rows.map((r) => this.mapEdgeRow(r));
  }

  public getInboundEdges(targetId: string): GraphEdge[] {
    const stmt = this.db.prepare(`
      SELECT * FROM kg_edges
      WHERE target_id = ?
      ORDER BY weight DESC
    `);
    const rows = stmt.all(targetId) as unknown as RawEdgeRow[];
    return rows.map((r) => this.mapEdgeRow(r));
  }

  public reinforceEdge(
    sourceId: string,
    targetId: string,
    relation: EdgeRelation,
    success: boolean
  ): void {
    const existing = this.getEdge(sourceId, targetId, relation);
    const now = new Date().toISOString();

    if (existing) {
      let newWeight: number;
      if (success) {
        // Asymptotic positive reinforcement
        newWeight = Math.min(1.0, existing.weight + 0.1 * (1.0 - existing.weight));
      } else {
        // Penalty on failure
        newWeight = Math.max(0.05, existing.weight - 0.15 * existing.weight);
      }

      const stmt = this.db.prepare(`
        UPDATE kg_edges
        SET weight = ?, sample_count = sample_count + 1, updated_at = ?
        WHERE source_id = ? AND target_id = ? AND relation = ?
      `);
      stmt.run(newWeight, now, sourceId, targetId, relation);
    } else {
      const initialWeight = success ? 0.6 : 0.4;
      this.saveEdge({
        id: `edge_${sourceId}_${targetId}_${Date.now()}`,
        sourceId,
        targetId,
        relation,
        weight: initialWeight,
        sampleCount: 1,
        updatedAt: now,
      });
    }
  }

  public deleteNode(id: string): void {
    const stmt = this.db.prepare('DELETE FROM kg_nodes WHERE id = ?');
    stmt.run(id);
    const edgeStmt = this.db.prepare('DELETE FROM kg_edges WHERE source_id = ? OR target_id = ?');
    edgeStmt.run(id, id);
  }

  public deleteEdge(id: string): void {
    const stmt = this.db.prepare('DELETE FROM kg_edges WHERE id = ?');
    stmt.run(id);
  }

  private mapNodeRow(row: RawNodeRow): GraphNode {
    let properties: Record<string, unknown> = {};
    try {
      properties = JSON.parse(row.properties);
    } catch {
      // Soft fail
    }

    return {
      id: row.id,
      type: row.type as NodeType,
      name: row.name,
      properties,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapEdgeRow(row: RawEdgeRow): GraphEdge {
    let metadata: Record<string, unknown> = {};
    try {
      metadata = JSON.parse(row.metadata);
    } catch {
      // Soft fail
    }

    return {
      id: row.id,
      sourceId: row.source_id,
      targetId: row.target_id,
      relation: row.relation as EdgeRelation,
      weight: row.weight,
      sampleCount: row.sample_count,
      metadata,
      updatedAt: row.updated_at,
    };
  }
}

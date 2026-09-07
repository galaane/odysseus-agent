import type { SqliteDatabase } from './Database.js';
import type { PersistedFindingRecord, PersistedSourceRecord } from './types.js';

export class ResearchRepository {
  constructor(private readonly db: SqliteDatabase) {}

  public saveSource(source: PersistedSourceRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO sources (id, task_id, url, title, domain, accessed_at, relevance)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      source.id,
      source.task_id,
      source.url,
      source.title,
      source.domain,
      source.accessed_at,
      source.relevance
    );
  }

  public getSource(id: string): PersistedSourceRecord | null {
    const stmt = this.db.prepare('SELECT * FROM sources WHERE id = ?');
    const row = stmt.get(id) as unknown as PersistedSourceRecord | undefined;
    return row || null;
  }

  public getSourceByUrl(taskId: string, url: string): PersistedSourceRecord | null {
    const stmt = this.db.prepare('SELECT * FROM sources WHERE task_id = ? AND url = ? LIMIT 1');
    const row = stmt.get(taskId, url) as unknown as PersistedSourceRecord | undefined;
    return row || null;
  }

  public getSourcesForTask(taskId: string): PersistedSourceRecord[] {
    const stmt = this.db.prepare('SELECT * FROM sources WHERE task_id = ? ORDER BY accessed_at ASC');
    return stmt.all(taskId) as unknown as PersistedSourceRecord[];
  }

  public saveFinding(finding: PersistedFindingRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO findings (id, task_id, claim, source_ids, confidence, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      finding.id,
      finding.task_id,
      finding.claim,
      finding.source_ids,
      finding.confidence,
      finding.notes,
      finding.created_at
    );
  }

  public getFinding(id: string): PersistedFindingRecord | null {
    const stmt = this.db.prepare('SELECT * FROM findings WHERE id = ?');
    const row = stmt.get(id) as unknown as PersistedFindingRecord | undefined;
    return row || null;
  }

  public getFindingsForTask(taskId: string): PersistedFindingRecord[] {
    const stmt = this.db.prepare('SELECT * FROM findings WHERE task_id = ? ORDER BY created_at ASC');
    return stmt.all(taskId) as unknown as PersistedFindingRecord[];
  }
}

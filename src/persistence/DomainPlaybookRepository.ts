import type { SqliteDatabase } from './Database.js';
import type { DomainPlaybookRecord } from './types.js';

export class DomainPlaybookRepository {
  constructor(private readonly db: SqliteDatabase) {}

  /**
   * Saves or updates a domain playbook pattern.
   * If a record for the same domain and pattern_key exists, increments success_count and updates last_applied_at.
   */
  public savePlaybook(playbook: Omit<DomainPlaybookRecord, 'success_count'> & { success_count?: number }): void {
    const existing = this.findPlaybook(playbook.domain, playbook.pattern_key);

    if (existing) {
      const stmt = this.db.prepare(`
        UPDATE domain_playbooks
        SET success_count = success_count + 1,
            playbook_data = ?,
            last_applied_at = ?
        WHERE id = ?
      `);
      stmt.run(playbook.playbook_data, playbook.last_applied_at, existing.id);
    } else {
      const stmt = this.db.prepare(`
        INSERT INTO domain_playbooks (id, domain, pattern_type, pattern_key, playbook_data, success_count, last_applied_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        playbook.id,
        playbook.domain,
        playbook.pattern_type,
        playbook.pattern_key,
        playbook.playbook_data,
        playbook.success_count ?? 1,
        playbook.last_applied_at,
        playbook.created_at
      );
    }
  }

  public findPlaybook(domain: string, patternKey: string): DomainPlaybookRecord | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM domain_playbooks
      WHERE domain = ? AND pattern_key = ?
      LIMIT 1
    `);
    const row = stmt.get(domain, patternKey);
    return (row as unknown as DomainPlaybookRecord) || undefined;
  }

  public getPlaybooksByDomain(domain: string): DomainPlaybookRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM domain_playbooks
      WHERE domain = ?
      ORDER BY success_count DESC, last_applied_at DESC
    `);
    return stmt.all(domain) as unknown as DomainPlaybookRecord[];
  }

  public getAllPlaybooks(): DomainPlaybookRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM domain_playbooks
      ORDER BY success_count DESC, last_applied_at DESC
    `);
    return stmt.all() as unknown as DomainPlaybookRecord[];
  }

  /**
   * Reinforces or adjusts the confidence/success weighting of an existing playbook.
   */
  public reinforcePlaybook(domain: string, patternKey: string, success: boolean): void {
    const existing = this.findPlaybook(domain, patternKey);
    if (!existing) return;

    const delta = success ? 1 : -1;
    const newCount = Math.max(0, existing.success_count + delta);

    const stmt = this.db.prepare(`
      UPDATE domain_playbooks
      SET success_count = ?,
          last_applied_at = ?
      WHERE id = ?
    `);
    stmt.run(newCount, new Date().toISOString(), existing.id);
  }

  public deletePlaybook(id: string): void {
    const stmt = this.db.prepare(`DELETE FROM domain_playbooks WHERE id = ?`);
    stmt.run(id);
  }
}

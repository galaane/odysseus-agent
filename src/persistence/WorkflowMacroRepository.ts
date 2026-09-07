import type { SqliteDatabase } from './Database.js';
import type { WorkflowMacro, ParameterizedMacroStep, MacroStatus } from '../macros/types.js';

interface RawMacroRow {
  id: string;
  domain: string;
  intent_key: string;
  parameter_keys: string;
  macro_data: string;
  status: string;
  success_count: number;
  failure_count: number;
  healing_count: number;
  last_healed_at: string | null;
  created_at: string;
  updated_at: string;
}

export class WorkflowMacroRepository {
  constructor(private readonly db: SqliteDatabase) {}

  public saveMacro(macro: WorkflowMacro): void {
    const stmt = this.db.prepare(`
      INSERT INTO workflow_macros (
        id, domain, intent_key, parameter_keys, macro_data, status,
        success_count, failure_count, healing_count, last_healed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        domain = excluded.domain,
        intent_key = excluded.intent_key,
        parameter_keys = excluded.parameter_keys,
        macro_data = excluded.macro_data,
        status = excluded.status,
        success_count = excluded.success_count,
        failure_count = excluded.failure_count,
        healing_count = excluded.healing_count,
        last_healed_at = excluded.last_healed_at,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      macro.id,
      macro.domain.toLowerCase(),
      macro.intentKey,
      JSON.stringify(macro.parameterKeys),
      JSON.stringify(macro.steps),
      macro.status,
      macro.successCount ?? 0,
      macro.failureCount ?? 0,
      macro.healingCount ?? 0,
      macro.lastHealedAt || null,
      macro.createdAt,
      macro.updatedAt
    );
  }

  public getMacroById(id: string): WorkflowMacro | null {
    const stmt = this.db.prepare('SELECT * FROM workflow_macros WHERE id = ?');
    const row = stmt.get(id) as unknown as RawMacroRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  public getMacro(id: string): WorkflowMacro | null {
    return this.getMacroById(id);
  }

  public deleteMacro(id: string): void {
    this.db.prepare('DELETE FROM workflow_macros WHERE id = ?').run(id);
  }


  public findMacro(domain: string, intentKey: string): WorkflowMacro | null {
    const stmt = this.db.prepare(`
      SELECT * FROM workflow_macros
      WHERE domain = ? AND intent_key = ? AND status != 'deprecated'
      ORDER BY
        CASE status WHEN 'verified' THEN 1 WHEN 'provisional' THEN 2 ELSE 3 END ASC,
        success_count DESC
      LIMIT 1
    `);
    const row = stmt.get(domain.toLowerCase(), intentKey) as unknown as RawMacroRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  public getMacroByDomainAndIntent(domain: string, intentKey: string): WorkflowMacro | null {
    return this.findMacro(domain, intentKey);
  }

  public listMacrosByDomain(domain: string): WorkflowMacro[] {
    const stmt = this.db.prepare(`
      SELECT * FROM workflow_macros
      WHERE domain = ? AND status != 'deprecated'
      ORDER BY success_count DESC
    `);
    const rows = stmt.all(domain.toLowerCase()) as unknown as RawMacroRow[];
    return rows.map((r) => this.mapRow(r));
  }

  public listAllMacros(): WorkflowMacro[] {
    const stmt = this.db.prepare(`
      SELECT * FROM workflow_macros
      WHERE status != 'deprecated'
      ORDER BY created_at DESC
    `);
    const rows = stmt.all() as unknown as RawMacroRow[];
    return rows.map((r) => this.mapRow(r));
  }

  public recordSuccess(id: string): void {
    const macro = this.getMacroById(id);
    if (!macro) return;

    const newSuccessCount = macro.successCount + 1;
    const newStatus: MacroStatus =
      macro.status === 'provisional' && newSuccessCount >= 2 ? 'verified' : macro.status;

    const stmt = this.db.prepare(`
      UPDATE workflow_macros
      SET success_count = ?, status = ?, failure_count = 0, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(newSuccessCount, newStatus, new Date().toISOString(), id);
  }

  public recordFailure(id: string): void {
    const macro = this.getMacroById(id);
    if (!macro) return;

    const newFailureCount = macro.failureCount + 1;
    const newStatus: MacroStatus =
      newFailureCount >= 3 ? 'degraded' : macro.status;

    const stmt = this.db.prepare(`
      UPDATE workflow_macros
      SET failure_count = ?, status = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(newFailureCount, newStatus, new Date().toISOString(), id);
  }

  public recordHealing(id: string, updatedSteps: ParameterizedMacroStep[]): void {
    const macro = this.getMacroById(id);
    if (!macro) return;

    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE workflow_macros
      SET
        macro_data = ?,
        healing_count = healing_count + 1,
        last_healed_at = ?,
        status = 'verified',
        failure_count = 0,
        updated_at = ?
      WHERE id = ?
    `);
    stmt.run(JSON.stringify(updatedSteps), now, now, id);
  }

  public deprecateMacro(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE workflow_macros
      SET status = 'deprecated', updated_at = ?
      WHERE id = ?
    `);
    stmt.run(new Date().toISOString(), id);
  }

  private mapRow(row: RawMacroRow): WorkflowMacro {
    let parameterKeys: string[] = [];
    let steps: ParameterizedMacroStep[] = [];

    try {
      parameterKeys = JSON.parse(row.parameter_keys);
    } catch {
      parameterKeys = [];
    }

    try {
      steps = JSON.parse(row.macro_data);
    } catch {
      steps = [];
    }

    return {
      id: row.id,
      domain: row.domain,
      intentKey: row.intent_key,
      parameterKeys,
      steps,
      status: row.status as MacroStatus,
      successCount: row.success_count,
      failureCount: row.failure_count,
      healingCount: row.healing_count,
      lastHealedAt: row.last_healed_at || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

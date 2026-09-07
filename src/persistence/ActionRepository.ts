import type { SqliteDatabase } from './Database.js';
import type { PersistedActionRecord } from './types.js';

export class ActionRepository {
  constructor(private readonly db: SqliteDatabase) {}

  public recordAction(action: PersistedActionRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO actions (id, task_id, step_index, action_type, parameters, success, duration_ms, error_code, error_message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      action.id,
      action.task_id,
      action.step_index,
      action.action_type,
      action.parameters,
      action.success,
      action.duration_ms,
      action.error_code,
      action.error_message,
      action.created_at
    );
  }

  public getActionsForTask(taskId: string): PersistedActionRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM actions
      WHERE task_id = ?
      ORDER BY step_index ASC, created_at ASC
    `);
    return stmt.all(taskId) as unknown as PersistedActionRecord[];
  }

  public getRecentActions(taskId: string, limit = 10): PersistedActionRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM actions
      WHERE task_id = ?
      ORDER BY step_index DESC, created_at DESC
      LIMIT ?
    `);
    return (stmt.all(taskId, limit) as unknown as PersistedActionRecord[]).reverse();
  }
}

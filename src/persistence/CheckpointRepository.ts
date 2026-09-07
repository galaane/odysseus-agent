import type { SqliteDatabase } from './Database.js';
import type { TaskCheckpointRecord } from './types.js';

export class CheckpointRepository {
  constructor(private readonly db: SqliteDatabase) {}

  public saveCheckpoint(checkpoint: TaskCheckpointRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO task_checkpoints (id, task_id, step_index, agent_state, current_url, active_tab_id, memory_snapshot, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      checkpoint.id,
      checkpoint.task_id,
      checkpoint.step_index,
      checkpoint.agent_state,
      checkpoint.current_url,
      checkpoint.active_tab_id,
      checkpoint.memory_snapshot,
      checkpoint.created_at
    );
  }

  public getLatestCheckpoint(taskId: string): TaskCheckpointRecord | null {
    const stmt = this.db.prepare(`
      SELECT * FROM task_checkpoints
      WHERE task_id = ?
      ORDER BY step_index DESC, created_at DESC
      LIMIT 1
    `);
    const row = stmt.get(taskId) as unknown as TaskCheckpointRecord | undefined;
    return row || null;
  }

  public getCheckpoints(taskId: string): TaskCheckpointRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM task_checkpoints
      WHERE task_id = ?
      ORDER BY step_index ASC, created_at ASC
    `);
    return stmt.all(taskId) as unknown as TaskCheckpointRecord[];
  }

  public deleteCheckpointsForTask(taskId: string): void {
    const stmt = this.db.prepare('DELETE FROM task_checkpoints WHERE task_id = ?');
    stmt.run(taskId);
  }
}

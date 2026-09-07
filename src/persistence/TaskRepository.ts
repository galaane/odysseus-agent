import type { SqliteDatabase } from './Database.js';
import type { TaskRecord, TaskStatus } from './types.js';

export class TaskRepository {
  constructor(private readonly db: SqliteDatabase) {}

  public createTask(task: {
    id: string;
    goal: string;
    max_steps: number;
    status?: TaskStatus;
    step_count?: number;
    created_at?: string;
  }): TaskRecord {
    const record: TaskRecord = {
      id: task.id,
      goal: task.goal,
      status: task.status || 'queued',
      max_steps: task.max_steps,
      step_count: task.step_count || 0,
      created_at: task.created_at || new Date().toISOString(),
      finished_at: null,
      error_code: null,
      error_message: null,
    };

    const stmt = this.db.prepare(`
      INSERT INTO tasks (id, goal, status, max_steps, step_count, created_at, finished_at, error_code, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      record.id,
      record.goal,
      record.status,
      record.max_steps,
      record.step_count,
      record.created_at,
      record.finished_at,
      record.error_code,
      record.error_message
    );

    return record;
  }

  public getTask(id: string): TaskRecord | null {
    const stmt = this.db.prepare('SELECT * FROM tasks WHERE id = ?');
    const row = stmt.get(id) as unknown as TaskRecord | undefined;
    return row || null;
  }

  public updateTaskStatus(
    id: string,
    status: TaskStatus,
    options?: {
      stepCount?: number;
      finishedAt?: string;
      errorCode?: string;
      errorMessage?: string;
    }
  ): void {
    const finishedAt =
      options?.finishedAt ??
      (['completed', 'failed', 'blocked', 'cancelled'].includes(status)
        ? new Date().toISOString()
        : null);

    const stmt = this.db.prepare(`
      UPDATE tasks
      SET status = ?,
          step_count = COALESCE(?, step_count),
          finished_at = COALESCE(?, finished_at),
          error_code = COALESCE(?, error_code),
          error_message = COALESCE(?, error_message)
      WHERE id = ?
    `);

    stmt.run(
      status,
      options?.stepCount ?? null,
      finishedAt,
      options?.errorCode ?? null,
      options?.errorMessage ?? null,
      id
    );
  }

  public incrementStep(id: string): number {
    const stmt = this.db.prepare(`
      UPDATE tasks
      SET step_count = step_count + 1
      WHERE id = ?
    `);
    stmt.run(id);

    const task = this.getTask(id);
    return task?.step_count ?? 0;
  }

  public listTasks(limit = 50): TaskRecord[] {
    const stmt = this.db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?');
    return stmt.all(limit) as unknown as TaskRecord[];
  }

  public deleteTask(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM tasks WHERE id = ?');
    const res = stmt.run(id);
    return Number(res.changes) > 0;
  }
}

import type { SqliteDatabase } from './Database.js';
import type { WatcherJob, WatcherJobStatus, WatcherConditionType, WatcherTriggerType } from '../watcher/types.js';

interface RawWatcherRow {
  id: string;
  name: string;
  target_url: string;
  condition_type: string;
  condition_target: string;
  condition_value: string;
  trigger_type: string;
  trigger_payload: string;
  interval_ms: number;
  adaptive_jitter: number;
  status: string;
  last_checked_at: number | null;
  expires_at: number | null;
  created_at: number;
  updated_at: number;
}

export class WatcherRepository {
  constructor(private readonly db: SqliteDatabase) {}

  public saveJob(job: WatcherJob): void {
    const stmt = this.db.prepare(`
      INSERT INTO watcher_jobs (
        id, name, target_url, condition_type, condition_target, condition_value,
        trigger_type, trigger_payload, interval_ms, adaptive_jitter, status,
        last_checked_at, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        target_url = excluded.target_url,
        condition_type = excluded.condition_type,
        condition_target = excluded.condition_target,
        condition_value = excluded.condition_value,
        trigger_type = excluded.trigger_type,
        trigger_payload = excluded.trigger_payload,
        interval_ms = excluded.interval_ms,
        adaptive_jitter = excluded.adaptive_jitter,
        status = excluded.status,
        last_checked_at = excluded.last_checked_at,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      job.id,
      job.name,
      job.targetUrl,
      job.conditionType,
      job.conditionTarget,
      String(job.conditionValue),
      job.triggerType,
      JSON.stringify(job.triggerPayload || {}),
      job.intervalMs,
      job.adaptiveJitter ? 1 : 0,
      job.status,
      job.lastCheckedAt ?? null,
      job.expiresAt ?? null,
      job.createdAt,
      job.updatedAt
    );
  }

  public getJob(id: string): WatcherJob | null {
    const stmt = this.db.prepare('SELECT * FROM watcher_jobs WHERE id = ?');
    const row = stmt.get(id) as unknown as RawWatcherRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  public getActiveJobs(): WatcherJob[] {
    const stmt = this.db.prepare(
      "SELECT * FROM watcher_jobs WHERE status = 'active' ORDER BY created_at ASC"
    );
    const rows = stmt.all() as unknown as RawWatcherRow[];
    return rows.map((r) => this.mapRow(r));
  }

  public getJobsByUrl(targetUrl: string): WatcherJob[] {
    const stmt = this.db.prepare(
      'SELECT * FROM watcher_jobs WHERE target_url = ? ORDER BY created_at ASC'
    );
    const rows = stmt.all(targetUrl) as unknown as RawWatcherRow[];
    return rows.map((r) => this.mapRow(r));
  }

  public getAllJobs(): WatcherJob[] {
    const stmt = this.db.prepare('SELECT * FROM watcher_jobs ORDER BY created_at DESC');
    const rows = stmt.all() as unknown as RawWatcherRow[];
    return rows.map((r) => this.mapRow(r));
  }

  public updateJobStatus(id: string, status: WatcherJobStatus, lastCheckedAt?: number): void {
    const now = Date.now();
    if (lastCheckedAt !== undefined) {
      this.db
        .prepare('UPDATE watcher_jobs SET status = ?, last_checked_at = ?, updated_at = ? WHERE id = ?')
        .run(status, lastCheckedAt, now, id);
    } else {
      this.db
        .prepare('UPDATE watcher_jobs SET status = ?, updated_at = ? WHERE id = ?')
        .run(status, now, id);
    }
  }

  public recordCheck(id: string, lastCheckedAt: number): void {
    this.db
      .prepare('UPDATE watcher_jobs SET last_checked_at = ?, updated_at = ? WHERE id = ?')
      .run(lastCheckedAt, Date.now(), id);
  }

  public deleteJob(id: string): void {
    this.db.prepare('DELETE FROM watcher_jobs WHERE id = ?').run(id);
  }

  public clearJobs(status?: WatcherJobStatus): void {
    if (status) {
      this.db.prepare('DELETE FROM watcher_jobs WHERE status = ?').run(status);
    } else {
      this.db.prepare('DELETE FROM watcher_jobs').run();
    }
  }

  private mapRow(row: RawWatcherRow): WatcherJob {
    let triggerPayload: Record<string, unknown> = {};
    try {
      triggerPayload = JSON.parse(row.trigger_payload);
    } catch {
      triggerPayload = {};
    }

    // Parse condition value as number if numerical, otherwise string
    let parsedConditionValue: string | number = row.condition_value;
    const num = Number(row.condition_value);
    if (!isNaN(num) && row.condition_value.trim() !== '') {
      parsedConditionValue = num;
    }

    return {
      id: row.id,
      name: row.name,
      targetUrl: row.target_url,
      conditionType: row.condition_type as WatcherConditionType,
      conditionTarget: row.condition_target,
      conditionValue: parsedConditionValue,
      triggerType: row.trigger_type as WatcherTriggerType,
      triggerPayload,
      intervalMs: row.interval_ms,
      adaptiveJitter: row.adaptive_jitter === 1,
      status: row.status as WatcherJobStatus,
      lastCheckedAt: row.last_checked_at ?? undefined,
      expiresAt: row.expires_at ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

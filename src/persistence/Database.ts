import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Logger } from '../logging/Logger.js';

const require = createRequire(import.meta.url);
const { DatabaseSync: NodeDatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (location: string, options?: { open?: boolean }) => DatabaseSync;
};

export interface DatabaseOptions {
  path?: string;
  logger?: Logger;
}

export class SqliteDatabase {
  private db: DatabaseSync | null = null;
  private readonly dbPath: string;
  private readonly logger?: Logger;
  private closed = false;

  constructor(options?: DatabaseOptions) {
    this.dbPath = options?.path || 'data/agent.db';
    this.logger = options?.logger;
    this.initialize();
  }

  private initialize(): void {
    if (this.dbPath !== ':memory:') {
      const dir = dirname(this.dbPath);
      try {
        mkdirSync(dir, { recursive: true });
      } catch {
        // Ignore directory creation errors if already exists
      }
    }

    this.db = new NodeDatabaseSync(this.dbPath);
    this.closed = false;

    // Enable foreign keys
    this.db.exec('PRAGMA foreign_keys = ON;');

    // Enable WAL mode for disk files
    if (this.dbPath !== ':memory:') {
      try {
        this.db.exec('PRAGMA journal_mode = WAL;');
      } catch {
        // In-memory or some systems might not support WAL
      }
    }

    this.applyMigrations();
    this.logger?.info('SqliteDatabase', `Database initialized at ${this.dbPath}`);
  }

  private applyMigrations(): void {
    if (!this.db) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        goal TEXT NOT NULL,
        status TEXT NOT NULL,
        max_steps INTEGER NOT NULL,
        step_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        finished_at TEXT,
        error_code TEXT,
        error_message TEXT
      );

      CREATE TABLE IF NOT EXISTS task_checkpoints (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        agent_state TEXT NOT NULL,
        current_url TEXT,
        active_tab_id TEXT,
        memory_snapshot TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS actions (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        action_type TEXT NOT NULL,
        parameters TEXT NOT NULL,
        success INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        url TEXT NOT NULL,
        title TEXT,
        domain TEXT NOT NULL,
        accessed_at TEXT NOT NULL,
        relevance REAL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS findings (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        claim TEXT NOT NULL,
        source_ids TEXT NOT NULL,
        confidence REAL,
        notes TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS domain_playbooks (
        id TEXT PRIMARY KEY,
        domain TEXT NOT NULL,
        pattern_type TEXT NOT NULL,
        pattern_key TEXT NOT NULL,
        playbook_data TEXT NOT NULL,
        success_count INTEGER NOT NULL DEFAULT 1,
        last_applied_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workflow_macros (
        id TEXT PRIMARY KEY,
        domain TEXT NOT NULL,
        intent_key TEXT NOT NULL,
        parameter_keys TEXT NOT NULL,
        macro_data TEXT NOT NULL,
        status TEXT NOT NULL,
        success_count INTEGER NOT NULL DEFAULT 0,
        failure_count INTEGER NOT NULL DEFAULT 0,
        healing_count INTEGER NOT NULL DEFAULT 0,
        last_healed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS kg_nodes (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        properties TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS kg_edges (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relation TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 0.5,
        sample_count INTEGER NOT NULL DEFAULT 1,
        metadata TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL,
        UNIQUE(source_id, target_id, relation)
      );

      CREATE TABLE IF NOT EXISTS site_topology_nodes (
        id TEXT PRIMARY KEY,
        domain TEXT NOT NULL,
        path TEXT NOT NULL,
        pattern TEXT NOT NULL,
        title TEXT,
        archetype TEXT NOT NULL,
        affordances TEXT NOT NULL DEFAULT '[]',
        depth INTEGER NOT NULL DEFAULT 0,
        visited_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(domain, path)
      );

      CREATE TABLE IF NOT EXISTS site_topology_edges (
        id TEXT PRIMARY KEY,
        domain TEXT NOT NULL,
        source_path TEXT NOT NULL,
        target_path TEXT NOT NULL,
        transition_type TEXT NOT NULL,
        trigger_selector TEXT NOT NULL,
        trigger_role TEXT,
        trigger_name TEXT,
        weight REAL NOT NULL DEFAULT 1.0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS domain_hyperparameters (
        id TEXT PRIMARY KEY,
        domain_or_archetype TEXT NOT NULL UNIQUE,
        risk_aversion REAL NOT NULL DEFAULT 0.5,
        max_retries INTEGER NOT NULL DEFAULT 2,
        token_budget INTEGER NOT NULL DEFAULT 3000,
        frustration_threshold INTEGER NOT NULL DEFAULT 3,
        prompt_directives TEXT NOT NULL DEFAULT '[]',
        sample_count INTEGER NOT NULL DEFAULT 0,
        success_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS watcher_jobs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        target_url TEXT NOT NULL,
        condition_type TEXT NOT NULL,
        condition_target TEXT NOT NULL,
        condition_value TEXT NOT NULL,
        trigger_type TEXT NOT NULL,
        trigger_payload TEXT NOT NULL DEFAULT '{}',
        interval_ms INTEGER NOT NULL DEFAULT 60000,
        adaptive_jitter INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'active',
        last_checked_at INTEGER,
        expires_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_checkpoints_task ON task_checkpoints(task_id);
      CREATE INDEX IF NOT EXISTS idx_actions_task ON actions(task_id);
      CREATE INDEX IF NOT EXISTS idx_sources_task ON sources(task_id);
      CREATE INDEX IF NOT EXISTS idx_findings_task ON findings(task_id);
      CREATE INDEX IF NOT EXISTS idx_playbooks_domain ON domain_playbooks(domain);
      CREATE INDEX IF NOT EXISTS idx_workflow_macros_domain ON workflow_macros(domain, intent_key);
      CREATE INDEX IF NOT EXISTS idx_kg_nodes_type ON kg_nodes(type);
      CREATE INDEX IF NOT EXISTS idx_kg_edges_source ON kg_edges(source_id);
      CREATE INDEX IF NOT EXISTS idx_kg_edges_target ON kg_edges(target_id);
      CREATE INDEX IF NOT EXISTS idx_kg_edges_relation ON kg_edges(relation);
      CREATE INDEX IF NOT EXISTS idx_topo_nodes_domain ON site_topology_nodes(domain);
      CREATE INDEX IF NOT EXISTS idx_topo_edges_domain_source ON site_topology_edges(domain, source_path);
      CREATE INDEX IF NOT EXISTS idx_hyperparams_target ON domain_hyperparameters(domain_or_archetype);
      CREATE INDEX IF NOT EXISTS idx_watcher_jobs_status ON watcher_jobs(status);
      CREATE INDEX IF NOT EXISTS idx_watcher_jobs_url ON watcher_jobs(target_url);
    `);
  }

  public getRawDb(): DatabaseSync {
    if (!this.db || this.closed) {
      throw new Error('Database is closed or not initialized');
    }
    return this.db;
  }

  public exec(sql: string): void {
    this.getRawDb().exec(sql);
  }

  public prepare(sql: string): StatementSync {
    return this.getRawDb().prepare(sql);
  }

  public transaction<T>(fn: () => T): T {
    const raw = this.getRawDb();
    raw.exec('BEGIN IMMEDIATE;');
    try {
      const result = fn();
      raw.exec('COMMIT;');
      return result;
    } catch (err) {
      raw.exec('ROLLBACK;');
      throw err;
    }
  }

  public close(): void {
    if (this.db && !this.closed) {
      this.db.close();
      this.closed = true;
      this.logger?.info('SqliteDatabase', 'Database connection closed');
    }
  }

  public isOpen(): boolean {
    return !this.closed && this.db !== null;
  }
}

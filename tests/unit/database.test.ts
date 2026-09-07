import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteDatabase } from '../../src/persistence/Database.js';
import { TaskRepository } from '../../src/persistence/TaskRepository.js';
import { CheckpointRepository } from '../../src/persistence/CheckpointRepository.js';
import { ActionRepository } from '../../src/persistence/ActionRepository.js';
import { ResearchRepository } from '../../src/persistence/ResearchRepository.js';

describe('Database & Persistence Subsystem (SQLite)', () => {
  let db: SqliteDatabase;
  let taskRepo: TaskRepository;
  let checkpointRepo: CheckpointRepository;
  let actionRepo: ActionRepository;
  let researchRepo: ResearchRepository;

  beforeEach(() => {
    db = new SqliteDatabase({ path: ':memory:' });
    taskRepo = new TaskRepository(db);
    checkpointRepo = new CheckpointRepository(db);
    actionRepo = new ActionRepository(db);
    researchRepo = new ResearchRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('SqliteDatabase Schema & Transactions', () => {
    it('should initialize schema with foreign keys enabled', () => {
      expect(db.isOpen()).toBe(true);

      const fkCheck = db.prepare('PRAGMA foreign_keys;').get() as { foreign_keys: number };
      expect(fkCheck.foreign_keys).toBe(1);

      // Verify all 5 core tables exist
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")
        .all() as Array<{ name: string }>;
      const tableNames = tables.map((t) => t.name);

      expect(tableNames).toContain('tasks');
      expect(tableNames).toContain('task_checkpoints');
      expect(tableNames).toContain('actions');
      expect(tableNames).toContain('sources');
      expect(tableNames).toContain('findings');
    });

    it('should commit transaction successfully', () => {
      db.transaction(() => {
        taskRepo.createTask({ id: 'task_tx_1', goal: 'Tx goal', max_steps: 10 });
        taskRepo.createTask({ id: 'task_tx_2', goal: 'Tx goal 2', max_steps: 10 });
      });

      expect(taskRepo.getTask('task_tx_1')).not.toBeNull();
      expect(taskRepo.getTask('task_tx_2')).not.toBeNull();
    });

    it('should rollback transaction on error', () => {
      expect(() => {
        db.transaction(() => {
          taskRepo.createTask({ id: 'task_rollback_1', goal: 'Rollback goal', max_steps: 10 });
          throw new Error('Transaction simulated failure');
        });
      }).toThrow('Transaction simulated failure');

      expect(taskRepo.getTask('task_rollback_1')).toBeNull();
    });
  });

  describe('TaskRepository', () => {
    it('should create and retrieve task records', () => {
      const task = taskRepo.createTask({
        id: 'task_001',
        goal: 'Scrape product listings',
        max_steps: 25,
      });

      expect(task.id).toBe('task_001');
      expect(task.status).toBe('queued');
      expect(task.step_count).toBe(0);

      const retrieved = taskRepo.getTask('task_001');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.goal).toBe('Scrape product listings');
      expect(retrieved?.max_steps).toBe(25);
    });

    it('should update task status and increment step counts', () => {
      taskRepo.createTask({ id: 'task_002', goal: 'Test updates', max_steps: 10 });

      taskRepo.incrementStep('task_002');
      const count = taskRepo.incrementStep('task_002');
      expect(count).toBe(2);

      taskRepo.updateTaskStatus('task_002', 'completed', { stepCount: 2 });
      const completedTask = taskRepo.getTask('task_002');
      expect(completedTask?.status).toBe('completed');
      expect(completedTask?.finished_at).toBeDefined();
    });

    it('should list tasks ordered by creation time', () => {
      taskRepo.createTask({ id: 'task_a', goal: 'Task A', max_steps: 5 });
      taskRepo.createTask({ id: 'task_b', goal: 'Task B', max_steps: 5 });

      const list = taskRepo.listTasks();
      expect(list.length).toBeGreaterThanOrEqual(2);
      expect(list.some((t) => t.id === 'task_a')).toBe(true);
      expect(list.some((t) => t.id === 'task_b')).toBe(true);
    });
  });

  describe('CheckpointRepository', () => {
    it('should save and retrieve checkpoints for a task', () => {
      taskRepo.createTask({ id: 'task_chk_1', goal: 'Test checkpoints', max_steps: 20 });

      checkpointRepo.saveCheckpoint({
        id: 'chk_1_step1',
        task_id: 'task_chk_1',
        step_index: 1,
        agent_state: 'acting',
        current_url: 'https://example.com/step1',
        active_tab_id: 'tab_001',
        memory_snapshot: JSON.stringify({ facts: ['fact 1'] }),
        created_at: '2026-09-06T00:00:01Z',
      });

      checkpointRepo.saveCheckpoint({
        id: 'chk_1_step2',
        task_id: 'task_chk_1',
        step_index: 2,
        agent_state: 'acting',
        current_url: 'https://example.com/step2',
        active_tab_id: 'tab_001',
        memory_snapshot: JSON.stringify({ facts: ['fact 1', 'fact 2'] }),
        created_at: '2026-09-06T00:00:02Z',
      });

      const latest = checkpointRepo.getLatestCheckpoint('task_chk_1');
      expect(latest).not.toBeNull();
      expect(latest?.id).toBe('chk_1_step2');
      expect(latest?.step_index).toBe(2);

      const all = checkpointRepo.getCheckpoints('task_chk_1');
      expect(all).toHaveLength(2);
    });
  });

  describe('ActionRepository', () => {
    it('should record actions and retrieve recent action history', () => {
      taskRepo.createTask({ id: 'task_act_1', goal: 'Test actions', max_steps: 10 });

      actionRepo.recordAction({
        id: 'act_1',
        task_id: 'task_act_1',
        step_index: 1,
        action_type: 'navigate',
        parameters: JSON.stringify({ url: 'https://example.com' }),
        success: 1,
        duration_ms: 120,
        error_code: null,
        error_message: null,
        created_at: new Date().toISOString(),
      });

      actionRepo.recordAction({
        id: 'act_2',
        task_id: 'task_act_1',
        step_index: 2,
        action_type: 'click',
        parameters: JSON.stringify({ targetId: 'el_001' }),
        success: 1,
        duration_ms: 80,
        error_code: null,
        error_message: null,
        created_at: new Date().toISOString(),
      });

      const actions = actionRepo.getActionsForTask('task_act_1');
      expect(actions).toHaveLength(2);
      expect(actions[0].action_type).toBe('navigate');
      expect(actions[1].action_type).toBe('click');

      const recent = actionRepo.getRecentActions('task_act_1', 1);
      expect(recent).toHaveLength(1);
      expect(recent[0].action_type).toBe('click');
    });
  });

  describe('ResearchRepository', () => {
    it('should persist sources and findings with relationship to tasks', () => {
      taskRepo.createTask({ id: 'task_res_1', goal: 'Research task', max_steps: 10 });

      researchRepo.saveSource({
        id: 'src_1',
        task_id: 'task_res_1',
        url: 'https://developer.mozilla.org/en-US/',
        title: 'MDN Web Docs',
        domain: 'developer.mozilla.org',
        accessed_at: new Date().toISOString(),
        relevance: 0.9,
      });

      const src = researchRepo.getSourceByUrl('task_res_1', 'https://developer.mozilla.org/en-US/');
      expect(src).not.toBeNull();
      expect(src?.domain).toBe('developer.mozilla.org');

      researchRepo.saveFinding({
        id: 'find_1',
        task_id: 'task_res_1',
        claim: 'Web APIs provide rich capabilities for automation',
        source_ids: JSON.stringify(['src_1']),
        confidence: 0.98,
        notes: 'Verified against MDN standard',
        created_at: new Date().toISOString(),
      });

      const findings = researchRepo.getFindingsForTask('task_res_1');
      expect(findings).toHaveLength(1);
      expect(findings[0].claim).toBe('Web APIs provide rich capabilities for automation');
    });
  });

  describe('Foreign Key Cascades (ON DELETE CASCADE)', () => {
    it('should automatically cascade-delete all related records when task is deleted', () => {
      taskRepo.createTask({ id: 'task_parent', goal: 'Parent task', max_steps: 10 });

      checkpointRepo.saveCheckpoint({
        id: 'chk_parent',
        task_id: 'task_parent',
        step_index: 1,
        agent_state: 'acting',
        current_url: null,
        active_tab_id: null,
        memory_snapshot: '{}',
        created_at: new Date().toISOString(),
      });

      actionRepo.recordAction({
        id: 'act_parent',
        task_id: 'task_parent',
        step_index: 1,
        action_type: 'click',
        parameters: '{}',
        success: 1,
        duration_ms: 10,
        error_code: null,
        error_message: null,
        created_at: new Date().toISOString(),
      });

      researchRepo.saveSource({
        id: 'src_parent',
        task_id: 'task_parent',
        url: 'https://test.com',
        title: 'Test',
        domain: 'test.com',
        accessed_at: new Date().toISOString(),
        relevance: 1,
      });

      researchRepo.saveFinding({
        id: 'find_parent',
        task_id: 'task_parent',
        claim: 'Test claim',
        source_ids: '["src_parent"]',
        confidence: 1,
        notes: null,
        created_at: new Date().toISOString(),
      });

      // Confirm records exist before deletion
      expect(checkpointRepo.getCheckpoints('task_parent')).toHaveLength(1);
      expect(actionRepo.getActionsForTask('task_parent')).toHaveLength(1);
      expect(researchRepo.getSourcesForTask('task_parent')).toHaveLength(1);
      expect(researchRepo.getFindingsForTask('task_parent')).toHaveLength(1);

      // Delete parent task
      const deleted = taskRepo.deleteTask('task_parent');
      expect(deleted).toBe(true);

      // Verify cascading deletion wiped all dependent rows
      expect(checkpointRepo.getCheckpoints('task_parent')).toHaveLength(0);
      expect(actionRepo.getActionsForTask('task_parent')).toHaveLength(0);
      expect(researchRepo.getSourcesForTask('task_parent')).toHaveLength(0);
      expect(researchRepo.getFindingsForTask('task_parent')).toHaveLength(0);
    });
  });
});

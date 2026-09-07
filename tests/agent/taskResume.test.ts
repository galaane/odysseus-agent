import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import type { Page, BrowserContext } from 'playwright-core';
import { OdysseusAgent } from '../../src/agent/Agent.js';
import { ActionRegistry } from '../../src/actions/ActionRegistry.js';
import { PageObserver } from '../../src/observer/PageObserver.js';
import { BrowserManager } from '../../src/browser/BrowserManager.js';
import { SqliteDatabase } from '../../src/persistence/Database.js';
import { TaskRepository } from '../../src/persistence/TaskRepository.js';
import { CheckpointRepository } from '../../src/persistence/CheckpointRepository.js';
import { ActionRepository } from '../../src/persistence/ActionRepository.js';
import { ResearchRepository } from '../../src/persistence/ResearchRepository.js';
import { Logger } from '../../src/logging/Logger.js';
import { loadConfig } from '../../src/config/Config.js';
import type { LLMProvider, LLMDecisionRequest } from '../../src/llm/LLM.js';
import type { LLMDecision } from '../../src/llm/schemas.js';

const TEST_DB_PATH = 'data/test-task-resume.db';

describe('Task Checkpointing & Resumption Subsystem (Phase 9 & Invariant 9)', () => {
  let db: SqliteDatabase;
  let logger: Logger;
  let mockPage: Page;
  let browserManager: BrowserManager;
  let actionRegistry: ActionRegistry;
  let pageObserver: PageObserver;
  const config = loadConfig({ BROWSER_HEADLESS: 'true' });

  beforeEach(async () => {
    if (existsSync(TEST_DB_PATH)) {
      try {
        unlinkSync(TEST_DB_PATH);
      } catch {
        // ignore
      }
    }

    db = new SqliteDatabase({ path: TEST_DB_PATH });
    logger = new Logger({ level: 'silent' });

    BrowserManager.resetInstanceForTesting();
    browserManager = BrowserManager.getInstance(config, logger);

    mockPage = {
      url: vi.fn(() => 'https://store.local/catalog'),
      title: vi.fn(async () => 'Store Catalog'),
      isClosed: vi.fn(() => false),
      evaluate: vi.fn().mockResolvedValue([]),
      locator: vi.fn(() => ({
        first: vi.fn(() => ({
          count: vi.fn(async () => 1),
          isVisible: vi.fn(async () => true),
          click: vi.fn(async () => {}),
        })),
        scrollIntoViewIfNeeded: vi.fn(async () => {}),
      })),
      on: vi.fn(() => mockPage),
      once: vi.fn(() => mockPage),
    } as unknown as Page;

    const mockContext = {
      pages: vi.fn(() => [mockPage]),
      newPage: vi.fn(async () => mockPage),
      on: vi.fn(() => mockContext),
    } as unknown as BrowserContext;

    await browserManager.getTabManager().init(mockContext);

    vi.spyOn(browserManager, 'runWithLock').mockImplementation(async (fn: any) => await fn());

    actionRegistry = new ActionRegistry();
    vi.spyOn(actionRegistry, 'dispatch').mockImplementation(async (action: any) => ({
      actionId: `act_${action.type}`,
      actionType: action.type,
      success: true,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 40,
    }));

    pageObserver = new PageObserver();
  });

  afterEach(() => {
    db.close();
    if (existsSync(TEST_DB_PATH)) {
      try {
        unlinkSync(TEST_DB_PATH);
      } catch {
        // ignore
      }
    }
  });

  it('should write checkpoints per step and resume seamlessly across fresh agent instances', async () => {
    // 1. Setup Mock LLM for Instance 1: executes step 1 (navigate) then maxSteps limit hits
    const llmInstance1: LLMProvider = {
      generateDecision: vi.fn(async (): Promise<LLMDecision> => ({
        status: 'continue',
        reasoning_summary: 'Navigating to product catalog',
        action: {
          id: 'act_nav_1',
          type: 'navigate',
          url: 'https://store.local/catalog',
          waitUntil: 'load',
        },
        expectedOutcome: 'Catalog page loaded',
      })),
    };

    const agent1 = new OdysseusAgent({
      browserManager,
      actionRegistry,
      pageObserver,
      llmProvider: llmInstance1,
      database: db,
      logger,
      config,
    });

    const taskId = 'task_resume_test_101';
    const goal = 'Find pricing for laptop';

    // Run agent 1 with maxSteps: 1
    const result1 = await agent1.run({
      id: taskId,
      goal,
      maxSteps: 1,
    });

    expect(result1.status).toBe('timeout');
    expect(result1.steps).toBe(1);

    // Verify checkpoint and actions were written to SQLite
    const checkpointRepo = new CheckpointRepository(db);
    const actionRepo = new ActionRepository(db);
    const taskRepo = new TaskRepository(db);

    const latestCheckpoint = checkpointRepo.getLatestCheckpoint(taskId);
    expect(latestCheckpoint).not.toBeNull();
    expect(latestCheckpoint?.step_index).toBe(1);
    expect(latestCheckpoint?.task_id).toBe(taskId);

    const actions = actionRepo.getActionsForTask(taskId);
    expect(actions).toHaveLength(1);
    expect(actions[0].action_type).toBe('navigate');

    const taskRecord = taskRepo.getTask(taskId);
    expect(taskRecord).not.toBeNull();
    expect(taskRecord?.step_count).toBe(1);

    // 2. Setup Mock LLM for Instance 2:
    // Step 2: click product
    // Step 3: complete with findings
    let instance2Calls = 0;
    const llmInstance2: LLMProvider = {
      generateDecision: vi.fn(async (): Promise<LLMDecision> => {
        instance2Calls++;
        if (instance2Calls === 1) {
          return {
            status: 'continue',
            reasoning_summary: 'Clicking on laptop item',
            action: {
              id: 'act_click_1',
              type: 'click',
              targetId: 'el_001',
            },
            expectedOutcome: 'Product detail opens',
          };
        }
        return {
          status: 'complete',
          reasoning_summary: 'Product found, pricing verified at $899',
          finalFindings: [
            {
              claim: 'Laptop price is $899',
              sourceUrls: ['https://store.local/catalog'],
              confidence: 0.99,
            },
          ],
        };
      }),
    };

    // Instantiate fresh agent 2 pointing to the same database
    const agent2 = new OdysseusAgent({
      browserManager,
      actionRegistry,
      pageObserver,
      llmProvider: llmInstance2,
      database: db,
      logger,
      config,
    });

    // Resume execution from the checkpoint with expanded maxSteps
    const result2 = await agent2.resumeFromCheckpoint(taskId, latestCheckpoint?.id, { maxSteps: 5 });

    expect(result2.status).toBe('completed');
    expect(result2.summary).toContain('pricing verified at $899');
    expect(result2.findings).toHaveLength(1);
    expect(result2.findings?.[0].claim).toBe('Laptop price is $899');

    // Total steps after resumption should be step 1 (restored) + step 2 = 2
    expect(result2.steps).toBe(2);

    // Verify all actions and findings persisted in SQLite
    const totalActions = actionRepo.getActionsForTask(taskId);
    expect(totalActions).toHaveLength(2);
    expect(totalActions[1].action_type).toBe('click');

    const researchRepo = new ResearchRepository(db);
    const findings = researchRepo.getFindingsForTask(taskId);
    expect(findings).toHaveLength(1);
    expect(findings[0].claim).toBe('Laptop price is $899');

    const finalTask = taskRepo.getTask(taskId);
    expect(finalTask?.status).toBe('completed');
    expect(finalTask?.step_count).toBe(2);
  });
});

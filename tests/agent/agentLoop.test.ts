import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page, BrowserContext } from 'playwright-core';
import { OdysseusAgent } from '../../src/agent/Agent.js';
import { BrowserManager } from '../../src/browser/BrowserManager.js';
import { ActionRegistry } from '../../src/actions/ActionRegistry.js';
import { PageObserver } from '../../src/observer/PageObserver.js';
import { MockLLMProvider } from '../../src/llm/OpenAIProvider.js';
import { Logger } from '../../src/logging/Logger.js';
import { loadConfig } from '../../src/config/Config.js';
import { AgentError } from '../../src/agent/AgentError.js';
import type { PageSnapshot } from '../../src/observer/PageSnapshot.js';

describe('OdysseusAgent & AgentLoop Subsystem', () => {
  let logger: Logger;
  let browserManager: BrowserManager;
  let actionRegistry: ActionRegistry;
  let pageObserver: PageObserver;
  let mockLLM: MockLLMProvider;
  let mockPage: Page;
  let agent: OdysseusAgent;

  beforeEach(async () => {
    logger = new Logger('debug', () => {});
    const config = loadConfig({ BROWSER_HEADLESS: 'true', MAX_AGENT_STEPS: '5' });

    BrowserManager.resetInstanceForTesting();
    browserManager = BrowserManager.getInstance(config, logger);

    mockPage = {
      url: vi.fn(() => 'https://example.com'),
      title: vi.fn(async () => 'Example Domain'),
      isClosed: vi.fn(() => false),
      bringToFront: vi.fn(async () => {}),
      goto: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      on: vi.fn(() => mockPage),
      once: vi.fn(() => mockPage),
      locator: vi.fn(() => ({
        scrollIntoViewIfNeeded: vi.fn(async () => {}),
        click: vi.fn(async () => {}),
      })),
      getByRole: vi.fn(() => ({
        scrollIntoViewIfNeeded: vi.fn(async () => {}),
        click: vi.fn(async () => {}),
      })),
      evaluate: vi.fn(async (fn: any) => {
        if (typeof fn === 'function' && fn.name === 'extractDOMStructureInPage') {
          return {
            headings: ['Heading 1: "Welcome"'],
            forms: [],
            links: [],
            notices: [],
            tables: [],
          };
        }
        return [
          { role: 'button', name: 'Sign In', tag: 'button', id: 'signin-btn' },
        ];
      }),
    } as unknown as Page;

    const mockContext = {
      pages: vi.fn(() => [mockPage]),
      newPage: vi.fn(async () => mockPage),
      on: vi.fn(() => mockContext),
      close: vi.fn(async () => {}),
    } as unknown as BrowserContext;

    await browserManager.getTabManager().init(mockContext);

    // Mock runWithLock to execute directly
    vi.spyOn(browserManager, 'runWithLock').mockImplementation(async (fn: any) => await fn());

    actionRegistry = new ActionRegistry();
    pageObserver = new PageObserver();
    mockLLM = new MockLLMProvider();

    const mockEvaluator = {
      evaluate: vi.fn(() => ({ status: 'success', observedChanges: [], reason: 'mocked success' })),
      evaluateCritically: vi.fn(async () => ({ status: 'success', observedChanges: [], reason: 'mocked critical success' })),
    } as any;

    agent = new OdysseusAgent({
      browserManager,
      actionRegistry,
      pageObserver,
      llmProvider: mockLLM,
      evaluator: mockEvaluator,
      logger,
      config,
    });
  });

  it('should complete multi-step task successfully with findings', async () => {
    // Decision 1: Navigate
    mockLLM.enqueueDecision({
      status: 'continue',
      reasoning_summary: 'Navigate to target store.',
      action: {
        id: 'act_1',
        type: 'navigate',
        url: 'https://example.com/store',
        waitUntil: 'load',
      },
      expectedOutcome: 'Store page loaded',
    });

    // Decision 2: Click button
    mockLLM.enqueueDecision({
      status: 'continue',
      reasoning_summary: 'Click sign in button.',
      action: {
        id: 'act_2',
        type: 'click',
        targetId: 'el_001',
      },
      expectedOutcome: 'Sign in dialog opened',
    });

    // Decision 3: Complete with findings
    mockLLM.enqueueDecision({
      status: 'complete',
      reasoning_summary: 'Pricing findings extracted successfully.',
      finalFindings: [
        {
          claim: 'Standard subscription is $20/mo',
          sourceUrls: ['https://example.com/store'],
          confidence: 1.0,
        },
      ],
    });

    const result = await agent.run({
      id: 'task_001',
      goal: 'Find subscription pricing',
    });

    expect(result.status).toBe('completed');
    expect(result.steps).toBe(2);
    expect(result.findings).toHaveLength(1);
    expect(result.findings?.[0].claim).toBe('Standard subscription is $20/mo');
    expect(agent.getState()).toBe('completed');
  });

  it('should terminate with timeout status when maximum steps are exceeded', async () => {
    // Enqueue decisions that keep continuing without completing
    for (let i = 0; i < 10; i++) {
      mockLLM.enqueueDecision({
        status: 'continue',
        reasoning_summary: `Step ${i + 1} scroll`,
        action: {
          id: `act_${i}`,
          type: 'scroll',
          direction: 'down',
          amount: 200,
        },
      });
    }

    const result = await agent.run({
      id: 'task_002',
      goal: 'Infinite scroll test',
      maxSteps: 3, // Lower max steps for test
    });

    expect(result.status).toBe('timeout');
    expect(result.steps).toBe(3);
    expect(result.summary).toContain('Maximum step limit');
  });

  it('should terminate with blocked status when LLM identifies external blocker', async () => {
    mockLLM.enqueueDecision({
      status: 'blocked',
      reasoning_summary: 'Encountered Cloudflare interactive turnstile CAPTCHA.',
    });

    const result = await agent.run({
      id: 'task_003',
      goal: 'Access protected portal',
    });

    expect(result.status).toBe('blocked');
    expect(result.summary).toContain('Cloudflare interactive turnstile CAPTCHA');
  });

  it('should enforce single-task execution policy (Invariant 1)', async () => {
    // Hang on first decision
    mockLLM.enqueueDecision({
      status: 'continue',
      reasoning_summary: 'Step 1',
      action: {
        id: 'act_1',
        type: 'wait',
        condition: 'timeout',
        timeoutMs: 50,
      },
    });

    // Start first task
    const taskPromise = agent.run({ id: 'task_active', goal: 'First task' });

    // Attempt second task while first is running
    await expect(agent.run({ id: 'task_concurrent', goal: 'Second task' })).rejects.toThrowError(
      AgentError
    );

    await taskPromise;
  });

  it('should handle stop/cancel signal cleanly', async () => {
    mockLLM.enqueueDecision({
      status: 'continue',
      reasoning_summary: 'Waiting',
      action: {
        id: 'act_1',
        type: 'wait',
        condition: 'timeout',
        timeoutMs: 100,
      },
    });

    // Trigger stop immediately after starting
    const runPromise = agent.run({ id: 'task_to_cancel', goal: 'Cancelled task' });
    await agent.stop();

    const result = await runPromise;
    expect(result.status).toBe('cancelled');
    expect(agent.getState()).toBe('stopped');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page, BrowserContext } from 'playwright-core';
import { OdysseusAgent } from '../../src/agent/Agent.js';
import { BrowserManager } from '../../src/browser/BrowserManager.js';
import { ActionRegistry } from '../../src/actions/ActionRegistry.js';
import { PageObserver } from '../../src/observer/PageObserver.js';
import { MockLLMProvider } from '../../src/llm/OpenAIProvider.js';
import { Logger } from '../../src/logging/Logger.js';
import { loadConfig } from '../../src/config/Config.js';
import { MemoryManager } from '../../src/memory/MemoryManager.js';

describe('DeadlockBreaker (Phase 21)', () => {
  let logger: Logger;
  let browserManager: BrowserManager;
  let actionRegistry: ActionRegistry;
  let pageObserver: PageObserver;
  let mockLLM: MockLLMProvider;
  let mockPage: Page;
  let agent: OdysseusAgent;
  let memoryManager: MemoryManager;

  beforeEach(async () => {
    logger = new Logger('silent', () => {});
    const config = loadConfig({ BROWSER_HEADLESS: 'true', MAX_AGENT_STEPS: '5' });

    BrowserManager.resetInstanceForTesting();
    browserManager = BrowserManager.getInstance(config, logger);
    memoryManager = new MemoryManager(config, logger);

    mockPage = {
      url: vi.fn(() => 'https://example.com/login'),
      title: vi.fn(async () => 'Login'),
      isClosed: vi.fn(() => false),
      bringToFront: vi.fn(async () => {}),
      goto: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      on: vi.fn(() => mockPage),
      once: vi.fn(() => mockPage),
      locator: vi.fn(() => ({
        scrollIntoViewIfNeeded: vi.fn(async () => {}),
        click: vi.fn(async () => {
          throw new Error('Element is not interactable');
        }),
      })),
      getByRole: vi.fn(() => ({
        scrollIntoViewIfNeeded: vi.fn(async () => {}),
        click: vi.fn(async () => {
          throw new Error('Element is not interactable');
        }),
      })),
      evaluate: vi.fn(async (fn: any) => {
        if (typeof fn === 'function' && fn.name === 'extractDOMStructureInPage') {
          return { headings: [], forms: [], links: [], notices: [], tables: [] };
        }
        return [{ role: 'button', name: 'Broken', tag: 'button', id: 'broken_btn' }];
      }),
    } as unknown as Page;

    const mockContext = {
      pages: vi.fn(() => [mockPage]),
      newPage: vi.fn(async () => mockPage),
      on: vi.fn(() => mockContext),
      close: vi.fn(async () => {}),
    } as unknown as BrowserContext;

    await browserManager.getTabManager().init(mockContext);
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
      memoryManager,
      logger,
      config,
    });
  });

  it('should force a strategy pivot when frustration threshold is reached', async () => {
    // LLM keeps trying to click the same broken button
    for (let i = 0; i < 4; i++) {
      mockLLM.enqueueDecision({
        status: 'continue',
        reasoning_summary: `Clicking broken button attempt ${i + 1}`,
        action: {
          id: `act_${i}`,
          type: 'click',
          targetId: 'broken_btn',
        },
      });
    }

    mockLLM.enqueueDecision({
      status: 'complete',
      reasoning_summary: 'Give up',
      finalFindings: [],
    });

    await agent.run({
      id: 'task_deadlock',
      goal: 'Click the button',
    });

    const memorySnapshot = memoryManager.getWorkingMemory().getFacts();
    
    const hasFrustrationWarning = memorySnapshot.some(fact => fact.includes('FRUSTRATION SYSTEM WARNING') || fact.includes('CRITICAL PIVOT'));
    expect(hasFrustrationWarning).toBe(true);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TrajectoryReflector } from '../../src/memory/TrajectoryReflector.js';
import { DomainPlaybookRepository } from '../../src/persistence/DomainPlaybookRepository.js';
import type { ActionRepository } from '../../src/persistence/ActionRepository.js';
import type { SqliteDatabase } from '../../src/persistence/Database.js';
import type { LLMProvider, LLMRequest } from '../../src/llm/LLM.js';
import { Logger } from '../../src/logging/Logger.js';

describe('Phase 26: Metacognitive Reflexion & Self-Refining Playbooks Subsystem', () => {
  let mockLLM: LLMProvider;
  let mockPlaybookRepo: DomainPlaybookRepository;
  let mockActionRepo: ActionRepository;
  let logger: Logger;
  let reflector: TrajectoryReflector;
  let capturedRequests: LLMRequest[];

  beforeEach(() => {
    capturedRequests = [];
    logger = new Logger('debug', () => {});

    mockLLM = {
      generateDecision: vi.fn().mockImplementation(async (req: LLMRequest) => {
        capturedRequests.push(req);
        return {
          status: 'continue',
          reasoning_summary: JSON.stringify({
            domain: 'shop.test',
            status: 'failed',
            evaluationSummary: 'Cart checkout button was blocked by newsletter modal',
            learnedRules: [
              {
                rule: 'Always close newsletter modal before attempting checkout',
                category: 'modal_handling',
                confidence: 0.9,
              },
            ],
            antiPatterns: ['Attempting to click checkout button when modal overlay is present'],
          }),
        };
      }),
      generateResponse: vi.fn(),
    };

    const savedPlaybooks: Array<Record<string, unknown>> = [];
    mockPlaybookRepo = {
      savePlaybook: vi.fn().mockImplementation((pb) => {
        savedPlaybooks.push(pb);
      }),
      findPlaybook: vi.fn().mockImplementation((domain, key) => {
        return savedPlaybooks.find((p) => p.domain === domain && p.pattern_key === key);
      }),
      getPlaybooksByDomain: vi.fn().mockImplementation((domain) => {
        return savedPlaybooks.filter((p) => p.domain === domain);
      }),
      reinforcePlaybook: vi.fn(),
    } as unknown as DomainPlaybookRepository;

    mockActionRepo = {
      getActionsForTask: vi.fn().mockReturnValue([
        { step_index: 1, action_type: 'navigate', success: 1 },
        { step_index: 2, action_type: 'click', success: 0, error_code: 'ELEMENT_NOT_INTERACTABLE', error_message: 'Modal in way' },
      ]),
    } as unknown as ActionRepository;

    reflector = new TrajectoryReflector({
      llmProvider: mockLLM,
      playbookRepo: mockPlaybookRepo,
      actionRepo: mockActionRepo,
      logger,
    });
  });

  describe('TrajectoryReflector.reflectOnTask', () => {
    it('should reflect on failed tasks with deep weighting and anti-pattern extraction', async () => {
      const reflection = await reflector.reflectOnTask({
        taskId: 'task_fail_101',
        goal: 'Buy shoes on shop.test',
        status: 'failed',
        summary: 'Failed to click checkout button',
        sources: [{ url: 'https://shop.test/checkout', title: 'Checkout', accessedAt: 'now' }],
        steps: 2,
      });

      expect(reflection).toBeDefined();
      expect(reflection?.domain).toBe('shop.test');
      expect(reflection?.status).toBe('failed');
      expect(reflection?.learnedRules).toHaveLength(1);
      expect(reflection?.learnedRules[0].rule).toContain('Always close newsletter modal');
      expect(reflection?.antiPatterns).toContain('Attempting to click checkout button when modal overlay is present');

      expect(capturedRequests).toHaveLength(1);
      expect(capturedRequests[0].reasoningTier).toBe('deep');
      expect((capturedRequests[0].messages[0].content as string)).toContain('DEEP FAILURE DIAGNOSTIC DIRECTIVE');

      expect(mockPlaybookRepo.savePlaybook).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: 'shop.test',
          pattern_type: 'reflexion_heuristic',
          pattern_key: expect.stringContaining('Always close newsletter modal'),
        })
      );
    });

    it('should reflect on successful tasks with procedural extraction', async () => {
      vi.mocked(mockLLM.generateDecision).mockImplementationOnce(async (req: LLMRequest) => {
        capturedRequests.push(req);
        return {
          status: 'continue',
          reasoning_summary: JSON.stringify({
            domain: 'shop.test',
            status: 'completed',
            evaluationSummary: 'Completed search and extraction smoothly',
            learnedRules: [
              {
                rule: 'Use direct search query URL instead of home page input for faster navigation',
                category: 'search',
                confidence: 0.85,
              },
            ],
            antiPatterns: [],
          }),
        };
      });

      const reflection = await reflector.reflectOnTask({
        taskId: 'task_succ_102',
        goal: 'Search shoes on shop.test',
        status: 'completed',
        summary: 'Found product details',
        sources: [{ url: 'https://shop.test/search?q=shoes', title: 'Search', accessedAt: 'now' }],
        steps: 3,
      });

      expect(reflection).toBeDefined();
      expect(reflection?.learnedRules[0].category).toBe('search');
      expect(capturedRequests[0].reasoningTier).toBe('fast');
      expect((capturedRequests[0].messages[0].content as string)).toContain('SUCCESS HEURISTIC DIRECTIVE');
    });

    it('should return undefined cleanly if no domain can be resolved', async () => {
      const reflection = await reflector.reflectOnTask({
        taskId: 'task_nodomain',
        goal: 'Invalid target',
        status: 'failed',
        summary: 'about:blank failure',
        sources: [],
        steps: 1,
      });

      expect(reflection).toBeUndefined();
      expect(capturedRequests).toHaveLength(0);
    });

    it('should fall back gracefully to default heuristic if LLM output is not valid JSON', async () => {
      vi.mocked(mockLLM.generateDecision).mockImplementationOnce(async (req: LLMRequest) => {
        capturedRequests.push(req);
        return {
          status: 'continue',
          reasoning_summary: 'Plain text analysis: The checkout flow broke due to network glitch.',
        };
      });

      const reflection = await reflector.reflectOnTask({
        taskId: 'task_plain_text',
        goal: 'Checkout item',
        status: 'failed',
        summary: 'Network failure',
        sources: [{ url: 'https://shop.test/order', title: 'Order', accessedAt: 'now' }],
        steps: 4,
      });

      expect(reflection).toBeDefined();
      expect(reflection?.domain).toBe('shop.test');
      expect(reflection?.learnedRules).toHaveLength(1);
      expect(reflection?.learnedRules[0].confidence).toBe(0.7);
    });
  });

  describe('DomainPlaybookRepository.reinforcePlaybook', () => {
    it('should increment or decrement success_count properly', () => {
      let runArgs: unknown[] = [];
      const mockDb = {
        prepare: vi.fn().mockImplementation((sql: string) => {
          if (sql.includes('SELECT * FROM domain_playbooks')) {
            return {
              get: vi.fn().mockReturnValue({
                id: 'pb_001',
                domain: 'shop.test',
                pattern_key: 'test_key',
                success_count: 3,
              }),
            };
          }
          if (sql.includes('UPDATE domain_playbooks')) {
            return {
              run: vi.fn().mockImplementation((...args) => {
                runArgs = args;
              }),
            };
          }
          return { get: vi.fn(), run: vi.fn(), all: vi.fn() };
        }),
      };

      const repo = new DomainPlaybookRepository(mockDb as unknown as SqliteDatabase);

      // Reinforce on success: 3 -> 4
      repo.reinforcePlaybook('shop.test', 'test_key', true);
      expect(runArgs[0]).toBe(4);

      // Reinforce on failure: 3 -> 2
      repo.reinforcePlaybook('shop.test', 'test_key', false);
      expect(runArgs[0]).toBe(2);
    });
  });
});

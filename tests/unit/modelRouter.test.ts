import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModelRouter } from '../../src/llm/ModelRouter.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../src/llm/LLM.js';
import type { LLMDecision } from '../../src/llm/schemas.js';
import { Logger } from '../../src/logging/Logger.js';

describe('Phase 19: Dual-Tier / Adaptive Reasoning Model Router', () => {
  let mockFastProvider: LLMProvider;
  let mockDeepProvider: LLMProvider;
  let router: ModelRouter;
  let logger: Logger;

  const validFastDecision: LLMDecision = {
    status: 'continue',
    reasoning_summary: 'Fast tier clicked primary search button',
    action: {
      type: 'click',
      id: 'act_fast_01',
      targetId: 'btn_search_01',
    },
    expectedOutcome: 'Search results load',
  };

  const validDeepDecision: LLMDecision = {
    status: 'continue',
    reasoning_summary: 'Deep tier formulated multi-stage strategy after evaluating canvas',
    deliberation: {
      observation_analysis: 'Chart rendering complete, extracting top metrics',
      encountered_obstacles: ['None'],
      alternative_considered: 'Inspect DOM table vs OCR',
      risk_assessment: 'Ensure element is stable',
    },
    action: {
      type: 'extract',
      id: 'act_deep_01',
      instruction: 'Extract chart figures',
      targetId: 'chart_summary',
    },
    expectedOutcome: 'Extracted chart figures',
  };

  beforeEach(() => {
    logger = new Logger('error', () => {});

    mockFastProvider = {
      generateDecision: vi.fn(async () => validFastDecision),
      generateResponse: vi.fn(async () => ({
        rawText: JSON.stringify(validFastDecision),
        parsedDecision: validFastDecision,
      })),
    };

    mockDeepProvider = {
      generateDecision: vi.fn(async () => validDeepDecision),
      generateResponse: vi.fn(async () => ({
        rawText: JSON.stringify(validDeepDecision),
        parsedDecision: validDeepDecision,
      })),
    };

    router = new ModelRouter({
      fastProvider: mockFastProvider,
      deepProvider: mockDeepProvider,
      logger,
      enableEscalationFallback: true,
    });
  });

  describe('Complexity Heuristics Classification (classifyTier)', () => {
    it('should classify routine browser interactions as fast tier', () => {
      const request: LLMRequest = {
        messages: [
          { role: 'system', content: 'You are Odysseus.' },
          { role: 'user', content: 'Click on the login link to proceed.' },
        ],
      };

      expect(router.classifyTier(request)).toBe('fast');
    });

    it('should classify multimodal vision prompts as deep tier', () => {
      const request: LLMRequest = {
        messages: [
          { role: 'system', content: 'You are Odysseus.' },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Analyze this chart screenshot.' },
              {
                type: 'image_url',
                image_url: { url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAE=' },
              },
            ],
          },
        ],
      };

      expect(router.classifyTier(request)).toBe('deep');
    });

    it('should classify goal decomposition / milestone planning as deep tier', () => {
      const request: LLMRequest = {
        messages: [
          {
            role: 'system',
            content: 'Decompose this goal into concise milestones for browser execution.',
          },
          { role: 'user', content: 'Research competitor pricing on AWS.' },
        ],
      };

      expect(router.classifyTier(request)).toBe('deep');
    });

    it('should classify error recovery and obstacle clearance as deep tier', () => {
      const request: LLMRequest = {
        messages: [
          { role: 'system', content: 'You are Odysseus.' },
          {
            role: 'user',
            content: 'Recovery Ladder Warning: Consecutive failures detected on Tier 2 obstruction clearance.',
          },
        ],
      };

      expect(router.classifyTier(request)).toBe('deep');
    });

    it('should respect explicit reasoningTier override in LLMRequest', () => {
      const requestDeep: LLMRequest = {
        messages: [{ role: 'user', content: 'Simple text' }],
        reasoningTier: 'deep',
      };
      expect(router.classifyTier(requestDeep)).toBe('deep');

      const requestFast: LLMRequest = {
        messages: [{ role: 'user', content: 'Decompose this goal into milestones' }],
        reasoningTier: 'fast',
      };
      expect(router.classifyTier(requestFast)).toBe('fast');
    });
  });

  describe('Routing Execution & Telemetry', () => {
    it('should execute decision on fast provider for simple requests and track stats', async () => {
      const request: LLMRequest = {
        messages: [{ role: 'user', content: 'Click on button #submit' }],
      };

      const decision = await router.generateDecision(request);

      expect(mockFastProvider.generateDecision).toHaveBeenCalledWith(request);
      expect(mockDeepProvider.generateDecision).not.toHaveBeenCalled();
      expect(decision).toEqual(validFastDecision);

      const stats = router.getStats();
      expect(stats.totalRequests).toBe(1);
      expect(stats.fastTierRouted).toBe(1);
      expect(stats.deepTierRouted).toBe(0);
      expect(stats.escalationsToDeep).toBe(0);
    });

    it('should execute decision on deep provider for multimodal requests and track stats', async () => {
      const request: LLMRequest = {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Observe canvas' },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,mock' } },
            ],
          },
        ],
      };

      const decision = await router.generateDecision(request);

      expect(mockDeepProvider.generateDecision).toHaveBeenCalledWith(request);
      expect(mockFastProvider.generateDecision).not.toHaveBeenCalled();
      expect(decision).toEqual(validDeepDecision);

      const stats = router.getStats();
      expect(stats.totalRequests).toBe(1);
      expect(stats.fastTierRouted).toBe(0);
      expect(stats.deepTierRouted).toBe(1);
    });

    it('should execute generateResponse on deep provider for explicit deep request', async () => {
      const request: LLMRequest = {
        messages: [{ role: 'user', content: 'Synthesize findings from all sources' }],
        reasoningTier: 'deep',
      };

      const response = await router.generateResponse(request);

      expect(mockDeepProvider.generateResponse).toHaveBeenCalled();
      expect(response.parsedDecision).toEqual(validDeepDecision);
    });
  });

  describe('Auto-Escalation Fallback', () => {
    it('should automatically escalate to deep provider when fast provider throws error', async () => {
      (mockFastProvider.generateDecision as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('HTTP 429: Fast model rate limit exceeded')
      );

      const request: LLMRequest = {
        messages: [{ role: 'user', content: 'Click on submit' }],
      };

      const decision = await router.generateDecision(request);

      expect(mockFastProvider.generateDecision).toHaveBeenCalledTimes(1);
      expect(mockDeepProvider.generateDecision).toHaveBeenCalledTimes(1);
      expect(decision).toEqual(validDeepDecision);

      const stats = router.getStats();
      expect(stats.totalRequests).toBe(1);
      expect(stats.fastTierRouted).toBe(1);
      expect(stats.escalationsToDeep).toBe(1);
    });

    it('should escalate in generateResponse when fast provider fails', async () => {
      (mockFastProvider.generateResponse as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('JSON parse error from fast model')
      );

      const request: LLMRequest = {
        messages: [{ role: 'user', content: 'Type query' }],
      };

      const response = await router.generateResponse(request);

      expect(mockFastProvider.generateResponse).toHaveBeenCalledTimes(1);
      expect(mockDeepProvider.generateResponse).toHaveBeenCalledTimes(1);
      expect(response.parsedDecision).toEqual(validDeepDecision);
      expect(router.getStats().escalationsToDeep).toBe(1);
    });

    it('should re-throw error if enableEscalationFallback is disabled', async () => {
      const strictRouter = new ModelRouter({
        fastProvider: mockFastProvider,
        deepProvider: mockDeepProvider,
        enableEscalationFallback: false,
      });

      (mockFastProvider.generateDecision as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Strict mode failure')
      );

      const request: LLMRequest = {
        messages: [{ role: 'user', content: 'Click link' }],
      };

      await expect(strictRouter.generateDecision(request)).rejects.toThrow('Strict mode failure');
      expect(mockDeepProvider.generateDecision).not.toHaveBeenCalled();
    });

    it('should support resetStats', () => {
      router.resetStats();
      const stats = router.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.fastTierRouted).toBe(0);
      expect(stats.deepTierRouted).toBe(0);
      expect(stats.escalationsToDeep).toBe(0);
    });
  });
});

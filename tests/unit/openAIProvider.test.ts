import { describe, it, expect, vi } from 'vitest';
import { OpenAIProvider, MockLLMProvider } from '../../src/llm/OpenAIProvider.js';
import { AgentError } from '../../src/agent/AgentError.js';
import { ErrorCodes } from '../../src/browser/BrowserError.js';
import type { LLMRequest } from '../../src/llm/LLM.js';

describe('OpenAIProvider Subsystem', () => {
  const sampleDecision = {
    status: 'continue',
    reasoning_summary: 'Click submit to continue login process.',
    action: {
      id: 'act_001',
      type: 'click',
      targetId: 'el_005',
    },
    expectedOutcome: 'Page navigates to dashboard.',
  };

  const sampleRequest: LLMRequest = {
    messages: [
      { role: 'system', content: 'You are an agent.' },
      { role: 'user', content: 'Goal: log in' },
    ],
  };

  it('should successfully send request and parse valid LLM decision', async () => {
    const mockFetch = vi.fn(async (url: string, init: any) => {
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      expect(init.method).toBe('POST');
      expect(init.headers['Authorization']).toBe('Bearer test-api-key');

      const body = JSON.parse(init.body);
      expect(body.model).toBe('gpt-4o');
      expect(body.response_format).toEqual({ type: 'json_object' });

      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify(sampleDecision),
              },
            },
          ],
          usage: {
            prompt_tokens: 50,
            completion_tokens: 30,
            total_tokens: 80,
          },
        }),
      } as unknown as Response;
    });

    const provider = new OpenAIProvider({
      apiKey: 'test-api-key',
      model: 'gpt-4o',
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const decision = await provider.generateDecision(sampleRequest);

    expect(decision.status).toBe('continue');
    expect(decision.reasoning_summary).toBe('Click submit to continue login process.');
    expect(decision.action?.type).toBe('click');
    expect(decision.action?.id).toBe('act_001');
  });

  it('should clean markdown backticks from model output', async () => {
    const wrappedContent = `\`\`\`json
${JSON.stringify(sampleDecision, null, 2)}
\`\`\``;

    const mockFetch = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: wrappedContent,
              },
            },
          ],
        }),
      } as unknown as Response;
    });

    const provider = new OpenAIProvider({
      apiKey: 'test-key',
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const decision = await provider.generateDecision(sampleRequest);
    expect(decision.status).toBe('continue');
  });

  it('should retry on HTTP 429 rate limit and succeed when subsequent request passes', async () => {
    let callCount = 0;

    const mockFetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: false,
          status: 429,
          headers: new Headers({ 'retry-after': '0' }),
          text: async () => 'Rate limit exceeded',
        } as unknown as Response;
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(sampleDecision) } }],
        }),
      } as unknown as Response;
    });

    const provider = new OpenAIProvider({
      apiKey: 'test-key',
      maxRetries: 2,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const decision = await provider.generateDecision(sampleRequest);
    expect(callCount).toBe(2);
    expect(decision.status).toBe('continue');
  });

  it('should throw AgentError(LLM_TIMEOUT) on timeout abort', async () => {
    const mockFetch = vi.fn(async (_url: string, init: any) => {
      const signal = init.signal as AbortSignal;
      const error: any = new Error('The operation was aborted.');
      error.name = 'AbortError';
      throw error;
    });

    const provider = new OpenAIProvider({
      apiKey: 'test-key',
      timeoutMs: 10,
      maxRetries: 0,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await expect(provider.generateDecision(sampleRequest)).rejects.toThrowError(AgentError);
    try {
      await provider.generateDecision(sampleRequest);
    } catch (err) {
      const aErr = err as AgentError;
      expect(aErr.code).toBe(ErrorCodes.LLM_TIMEOUT);
    }
  });

  it('should throw AgentError(LLM_INVALID_OUTPUT) when output cannot be parsed as JSON', async () => {
    const mockFetch = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'Sorry, I cannot help with that.' } }],
        }),
      } as unknown as Response;
    });

    const provider = new OpenAIProvider({
      apiKey: 'test-key',
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await expect(provider.generateDecision(sampleRequest)).rejects.toThrowError(AgentError);
    try {
      await provider.generateDecision(sampleRequest);
    } catch (err) {
      const aErr = err as AgentError;
      expect(aErr.code).toBe(ErrorCodes.LLM_INVALID_OUTPUT);
    }
  });

  describe('MockLLMProvider', () => {
    it('should return queued decisions and fallback to default wait action', async () => {
      const mockProvider = new MockLLMProvider();

      const customDecision = {
        status: 'complete' as const,
        reasoning_summary: 'Research concluded successfully.',
      };

      mockProvider.enqueueDecision(customDecision);

      const res1 = await mockProvider.generateDecision(sampleRequest);
      expect(res1.status).toBe('complete');
      expect(res1.reasoning_summary).toBe('Research concluded successfully.');

      const res2 = await mockProvider.generateDecision(sampleRequest);
      expect(res2.status).toBe('continue');
      expect(res2.action?.type).toBe('wait');
    });

    it('should throw queued error', async () => {
      const mockProvider = new MockLLMProvider();
      mockProvider.enqueueError(new AgentError(ErrorCodes.LLM_TIMEOUT, 'Simulated timeout'));

      await expect(mockProvider.generateDecision(sampleRequest)).rejects.toThrowError('Simulated timeout');
    });
  });
});

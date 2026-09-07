import type { LLMProvider, LLMRequest, LLMResponse } from './LLM.js';
import { validateDecision, type LLMDecision } from './schemas.js';
import { AgentError } from '../agent/AgentError.js';
import { ErrorCodes } from '../browser/BrowserError.js';

export interface OpenAIProviderOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchFn?: typeof fetch;
}

interface OpenAIChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export class OpenAIProvider implements LLMProvider {
  private apiKey: string;
  private model: string;
  private baseUrl: string;
  private timeoutMs: number;
  private maxRetries: number;
  private fetchFn: typeof fetch;

  constructor(options: OpenAIProviderOptions = {}) {
    this.apiKey = options.apiKey || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '';
    this.model = options.model || process.env.LLM_MODEL || 'gpt-4o';
    this.baseUrl = (options.baseUrl || process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 60000;
    this.maxRetries = options.maxRetries ?? 3;
    this.fetchFn = options.fetchFn || globalThis.fetch;
  }

  /**
   * Sends an LLMRequest to the OpenAI-compatible chat completion endpoint,
   * enforces JSON structured output, retries with backoff on 429/5xx,
   * and validates the parsed decision against LLMDecisionSchema.
   */
  public async generateDecision(request: LLMRequest): Promise<LLMDecision> {
    const response = await this.generateResponse(request);
    if (!response.parsedDecision) {
      throw new AgentError(
        ErrorCodes.LLM_INVALID_OUTPUT,
        'LLM response did not contain a valid decision payload',
        { rawText: response.rawText }
      );
    }
    return response.parsedDecision;
  }

  /**
   * Generates a raw and structured LLMResponse.
   */
  public async generateResponse(request: LLMRequest): Promise<LLMResponse> {
    const endpoint = `${this.baseUrl}/chat/completions`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const payload = {
      model: this.model,
      messages: request.messages,
      temperature: request.temperature ?? 0.1,
      max_tokens: request.maxTokens ?? 2000,
      response_format: request.responseFormat === 'text' ? undefined : { type: 'json_object' },
    };

    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt <= this.maxRetries) {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const res = await this.fetchFn(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutHandle);

        // Handle Rate Limit (429) or Server Errors (5xx) with backoff retry
        if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
          const errorBody = await res.text().catch(() => '');
          attempt++;
          if (attempt > this.maxRetries) {
            throw new AgentError(
              ErrorCodes.LLM_INVALID_OUTPUT,
              `LLM API error (HTTP ${res.status}): ${errorBody}`,
              { status: res.status, body: errorBody }
            );
          }

          // Inspect Retry-After header if present (in seconds)
          const retryAfterHeader = res.headers.get('retry-after');
          let delayMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 0;
          if (!delayMs || isNaN(delayMs) || delayMs < 0) {
            // Exponential backoff: 1s, 2s, 4s... capped at 10s
            delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          }

          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        if (!res.ok) {
          const errorText = await res.text().catch(() => '');
          throw new AgentError(
            ErrorCodes.LLM_INVALID_OUTPUT,
            `LLM API request failed with HTTP ${res.status}: ${errorText}`,
            { status: res.status, body: errorText }
          );
        }

        const data = (await res.json()) as OpenAIChatCompletionResponse;
        const rawContent = data.choices?.[0]?.message?.content ?? '';

        if (!rawContent) {
          throw new AgentError(
            ErrorCodes.LLM_INVALID_OUTPUT,
            'LLM returned empty completion message content',
            { rawResponse: data }
          );
        }

        // Clean markdown backticks if model wrapped JSON in ```json ... ```
        const cleanedContent = this.stripMarkdownFences(rawContent);
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(cleanedContent);
        } catch (jsonErr) {
          throw new AgentError(
            ErrorCodes.LLM_INVALID_OUTPUT,
            `LLM output is not valid JSON: ${(jsonErr as Error).message}`,
            { rawContent, cleanedContent }
          );
        }

        const parsedDecision = validateDecision(parsedJson);

        return {
          rawText: rawContent,
          parsedDecision,
          tokensUsed: data.usage
            ? {
                prompt: data.usage.prompt_tokens ?? 0,
                completion: data.usage.completion_tokens ?? 0,
                total: data.usage.total_tokens ?? 0,
              }
            : undefined,
        };
      } catch (err: unknown) {
        clearTimeout(timeoutHandle);

        if (err instanceof AgentError) {
          throw err;
        }

        const isAbort = (err instanceof Error && err.name === 'AbortError') || controller.signal.aborted;
        if (isAbort) {
          throw new AgentError(
            ErrorCodes.LLM_TIMEOUT,
            `LLM request timed out after ${this.timeoutMs}ms`,
            { timeoutMs: this.timeoutMs }
          );
        }

        lastError = err instanceof Error ? err : new Error(String(err));
        attempt++;

        if (attempt > this.maxRetries) {
          throw new AgentError(
            ErrorCodes.LLM_INVALID_OUTPUT,
            `LLM call failed after ${this.maxRetries} retries: ${lastError.message}`,
            { originalError: lastError.message }
          );
        }

        const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw new AgentError(
      ErrorCodes.LLM_INVALID_OUTPUT,
      `LLM failed after ${this.maxRetries} attempts: ${lastError?.message || 'Unknown error'}`
    );
  }

  /**
   * Helper to strip markdown fences (```json ... ```) if present.
   */
  private stripMarkdownFences(text: string): string {
    const trimmed = text.trim();
    if (trimmed.startsWith('```')) {
      const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    return trimmed;
  }
}

/**
 * Deterministic in-memory mock provider for testing without live API keys.
 */
export class MockLLMProvider implements LLMProvider {
  private queue: Array<LLMDecision | Error> = [];

  public enqueueDecision(decision: LLMDecision): void {
    this.queue.push(decision);
  }

  public enqueueError(error: Error): void {
    this.queue.push(error);
  }

  public async generateDecision(_request: LLMRequest): Promise<LLMDecision> {
    if (this.queue.length === 0) {
      return {
        status: 'continue',
        reasoning_summary: 'Default mock decision: wait for dynamic content',
        action: {
          id: 'mock_act_1',
          type: 'wait',
          condition: 'timeout',
          timeoutMs: 1000,
        },
        expectedOutcome: 'Page remains loaded',
      };
    }

    const next = this.queue.shift()!;
    if (next instanceof Error) {
      throw next;
    }
    return next;
  }
}

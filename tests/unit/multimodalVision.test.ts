import { describe, it, expect, vi } from 'vitest';
import type { Page } from 'playwright-core';
import { ScreenshotObserver } from '../../src/observer/ScreenshotObserver.js';
import { PromptBuilder } from '../../src/llm/PromptBuilder.js';
import { OpenAIProvider } from '../../src/llm/OpenAIProvider.js';
import type { LLMRequest, MessageContentPart } from '../../src/llm/LLM.js';

describe('Phase 15: Multimodal Vision & Visual Grounding Subsystem', () => {
  describe('ScreenshotObserver.captureBase64', () => {
    it('should capture page screenshot and encode directly to Base64', async () => {
      const observer = new ScreenshotObserver();
      const mockBuffer = Buffer.from('mock-png-binary-data');

      const mockPage = {
        screenshot: vi.fn().mockResolvedValue(mockBuffer),
      } as unknown as Page;

      const base64 = await observer.captureBase64(mockPage);

      expect(mockPage.screenshot).toHaveBeenCalledWith({
        fullPage: false,
        type: 'png',
      });
      expect(base64).toBe(mockBuffer.toString('base64'));
    });

    it('should throw BROWSER_NOT_CONNECTED if page is null', async () => {
      const observer = new ScreenshotObserver();
      await expect(observer.captureBase64(null as unknown as Page)).rejects.toThrow(
        'Cannot capture screenshot: page is null'
      );
    });
  });

  describe('PromptBuilder Multimodal Assembling', () => {
    const builder = new PromptBuilder();

    it('should produce OpenAI-compatible MessageContentPart[] when screenshotBase64 is provided', () => {
      const fakeBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

      const messages = builder.buildMessages({
        goal: 'Look at the chart and extract the highest value',
        screenshotBase64: fakeBase64,
        currentObservationText: '[Page: ChartView]',
      });

      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('system');
      expect(messages[1].role).toBe('user');

      // Check multimodal content parts
      const userContent = messages[1].content as MessageContentPart[];
      expect(Array.isArray(userContent)).toBe(true);
      expect(userContent).toHaveLength(2);

      expect(userContent[0].type).toBe('text');
      expect((userContent[0] as { type: 'text'; text: string }).text).toContain('Task Goal');

      expect(userContent[1].type).toBe('image_url');
      expect((userContent[1] as { type: 'image_url'; image_url: { url: string } }).image_url.url).toBe(
        `data:image/png;base64,${fakeBase64}`
      );
    });

    it('should maintain standard string content when screenshotBase64 is not provided', () => {
      const messages = builder.buildMessages({
        goal: 'Search for documentation',
        currentObservationText: '[Page: Docs]',
      });

      expect(typeof messages[1].content).toBe('string');
    });
  });

  describe('OpenAIProvider Multimodal Payload Serialization', () => {
    it('should serialize multimodal messages cleanly to the OpenAI-compatible endpoint', async () => {
      let capturedPayload: unknown = null;

      const mockFetch = vi.fn().mockImplementation(async (_url, options) => {
        capturedPayload = JSON.parse(options.body as string);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    status: 'continue',
                    reasoning_summary: 'Observed highest peak in chart at $450.',
                    action: { type: 'scroll', direction: 'down', amount: 300 },
                    expectedOutcome: 'Scrolled to table section.',
                  }),
                },
              },
            ],
          }),
        };
      });

      const provider = new OpenAIProvider({
        apiKey: 'test-key',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o',
        fetchFn: mockFetch as typeof fetch,
      });

      const request: LLMRequest = {
        messages: [
          { role: 'system', content: 'You are Odysseus.' },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Analyze this chart:' },
              {
                type: 'image_url',
                image_url: { url: 'data:image/png;base64,ZmFrZWltYWdl' },
              },
            ],
          },
        ],
      };

      const decision = await provider.generateDecision(request);

      expect(decision.status).toBe('continue');
      expect(decision.reasoning_summary).toContain('highest peak');

      // Verify the serialized request payload sent to the endpoint
      const payload = capturedPayload as { messages: Array<{ role: string; content: unknown }> };
      expect(payload.messages[1].content).toEqual([
        { type: 'text', text: 'Analyze this chart:' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,ZmFrZWltYWdl' } },
      ]);
    });
  });
});

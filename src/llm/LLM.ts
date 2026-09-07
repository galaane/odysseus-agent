import type { LLMDecision } from './schemas.js';

export type MessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } };

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | MessageContentPart[];
}

export interface LLMRequest {
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'json_object' | 'text';
  reasoningTier?: 'auto' | 'fast' | 'deep';
  reasoningEffort?: 'low' | 'medium' | 'high';
}

export interface LLMResponse {
  rawText: string;
  parsedDecision?: LLMDecision;
  tokensUsed?: {
    prompt: number;
    completion: number;
    total: number;
  };
}

export interface LLMProvider {
  generateDecision(request: LLMRequest): Promise<LLMDecision>;
  generateResponse?(request: LLMRequest): Promise<LLMResponse>;
}

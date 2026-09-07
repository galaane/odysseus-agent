import type { LLMProvider, LLMRequest, LLMResponse, MessageContentPart } from './LLM.js';
import type { LLMDecision } from './schemas.js';
import { AgentError } from '../agent/AgentError.js';
import { ErrorCodes } from '../browser/BrowserError.js';
import type { Logger } from '../logging/Logger.js';

export interface ModelRouterOptions {
  fastProvider: LLMProvider;
  deepProvider: LLMProvider;
  logger?: Logger;
  defaultTier?: 'auto' | 'fast' | 'deep';
  enableEscalationFallback?: boolean;
}

export interface RoutingStats {
  totalRequests: number;
  fastTierRouted: number;
  deepTierRouted: number;
  escalationsToDeep: number;
}

export class ModelRouter implements LLMProvider {
  private fastProvider: LLMProvider;
  private deepProvider: LLMProvider;
  private logger?: Logger;
  private defaultTier: 'auto' | 'fast' | 'deep';
  private enableEscalationFallback: boolean;

  private stats: RoutingStats = {
    totalRequests: 0,
    fastTierRouted: 0,
    deepTierRouted: 0,
    escalationsToDeep: 0,
  };

  constructor(options: ModelRouterOptions) {
    this.fastProvider = options.fastProvider;
    this.deepProvider = options.deepProvider;
    this.logger = options.logger;
    this.defaultTier = options.defaultTier ?? 'auto';
    this.enableEscalationFallback = options.enableEscalationFallback ?? true;
  }

  /**
   * Classifies request complexity and determines optimal LLM reasoning tier ('fast' vs 'deep').
   */
  public classifyTier(request: LLMRequest): 'fast' | 'deep' {
    // 1. Explicit request-level tier takes top precedence
    if (request.reasoningTier === 'deep') {
      return 'deep';
    }
    if (request.reasoningTier === 'fast') {
      return 'fast';
    }

    // 2. Multimodal Perception Check: Any visual screenshot requires deep vision reasoning
    for (const msg of request.messages) {
      if (Array.isArray(msg.content)) {
        const parts = msg.content as MessageContentPart[];
        if (parts.some((p) => p.type === 'image_url')) {
          return 'deep';
        }
      }
    }

    // 3. Cognitive Context Heuristics: Goal decomposition, obstacle clearance, research synthesis
    const fullPromptText = request.messages
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join(' ')
      .toLowerCase();

    const deepPatterns = [
      'decompose this goal',
      'formulate a plan',
      'milestones',
      'recovery ladder',
      'consecutive failures',
      'tier 2',
      'tier 3',
      'obstruction clearance',
      'synthesize findings',
      'waiting_human_intervention',
      'captcha',
    ];

    for (const pattern of deepPatterns) {
      if (fullPromptText.includes(pattern)) {
        return 'deep';
      }
    }

    // 4. Default to fast model for routine interactions if auto
    return this.defaultTier === 'deep' ? 'deep' : 'fast';
  }

  /**
   * Generates structured decision via the routed model, with automatic fallback escalation.
   */
  public async generateDecision(request: LLMRequest): Promise<LLMDecision> {
    const tier = this.classifyTier(request);
    this.stats.totalRequests++;

    if (tier === 'deep') {
      this.stats.deepTierRouted++;
      this.logger?.debug('ModelRouter', 'Routing request directly to deep reasoning provider');
      return this.deepProvider.generateDecision(request);
    }

    // Fast tier execution
    this.stats.fastTierRouted++;
    this.logger?.debug('ModelRouter', 'Routing request to fast execution provider');

    try {
      return await this.fastProvider.generateDecision(request);
    } catch (err: unknown) {
      if (!this.enableEscalationFallback) {
        throw err;
      }

      this.stats.escalationsToDeep++;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger?.warn(
        'ModelRouter',
        `Fast model failed or produced invalid schema (${msg}). Auto-escalating to deep reasoning provider...`
      );

      // Escalate to deep provider with higher token allowance
      const escalatedRequest: LLMRequest = {
        ...request,
        reasoningTier: 'deep',
        maxTokens: Math.max(request.maxTokens ?? 2000, 3000),
      };

      return await this.deepProvider.generateDecision(escalatedRequest);
    }
  }

  /**
   * Generates a raw and structured LLMResponse, with automatic fallback escalation.
   */
  public async generateResponse(request: LLMRequest): Promise<LLMResponse> {
    const tier = this.classifyTier(request);
    this.stats.totalRequests++;

    if (tier === 'deep') {
      this.stats.deepTierRouted++;
      this.logger?.debug('ModelRouter', 'Routing generateResponse to deep reasoning provider');
      if (this.deepProvider.generateResponse) {
        return this.deepProvider.generateResponse(request);
      }
      const decision = await this.deepProvider.generateDecision(request);
      return { rawText: JSON.stringify(decision), parsedDecision: decision };
    }

    this.stats.fastTierRouted++;
    this.logger?.debug('ModelRouter', 'Routing generateResponse to fast execution provider');

    try {
      if (this.fastProvider.generateResponse) {
        return await this.fastProvider.generateResponse(request);
      }
      const decision = await this.fastProvider.generateDecision(request);
      return { rawText: JSON.stringify(decision), parsedDecision: decision };
    } catch (err: unknown) {
      if (!this.enableEscalationFallback) {
        throw err;
      }

      this.stats.escalationsToDeep++;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger?.warn(
        'ModelRouter',
        `Fast model response failed (${msg}). Auto-escalating generateResponse to deep reasoning provider...`
      );

      const escalatedRequest: LLMRequest = {
        ...request,
        reasoningTier: 'deep',
        maxTokens: Math.max(request.maxTokens ?? 2000, 3000),
      };

      if (this.deepProvider.generateResponse) {
        return await this.deepProvider.generateResponse(escalatedRequest);
      }
      const decision = await this.deepProvider.generateDecision(escalatedRequest);
      return { rawText: JSON.stringify(decision), parsedDecision: decision };
    }
  }

  /**
   * Returns telemetry metrics for routing decisions and fallback escalations.
   */
  public getStats(): Readonly<RoutingStats> {
    return { ...this.stats };
  }

  /**
   * Resets routing telemetry metrics.
   */
  public resetStats(): void {
    this.stats = {
      totalRequests: 0,
      fastTierRouted: 0,
      deepTierRouted: 0,
      escalationsToDeep: 0,
    };
  }

  public getFastProvider(): LLMProvider {
    return this.fastProvider;
  }

  public getDeepProvider(): LLMProvider {
    return this.deepProvider;
  }
}

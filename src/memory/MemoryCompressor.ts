import type { LLMProvider } from '../llm/LLM.js';
import type { ActionHistoryEntry } from '../llm/PromptBuilder.js';
import type { Logger } from '../logging/Logger.js';

export class MemoryCompressor {
  constructor(private readonly fastProvider: LLMProvider, private readonly logger?: Logger) {}

  /**
   * Compresses a list of recent technical action logs into a single semantic string
   * summarizing what was accomplished.
   */
  public async compressRecentActions(actions: ActionHistoryEntry[]): Promise<string> {
    if (actions.length === 0) {
      return '';
    }

    const actionText = actions
      .map((a) => `Step ${a.step}: ${a.actionType} on target ${a.targetId || 'N/A'} -> ${a.outcome}. Summary: ${a.summary}`)
      .join('\n');

    try {
      const request = {
        messages: [
          {
            role: 'system' as const,
            content:
              'You are a memory condensation module. Your job is to compress raw browser action logs into a single concise sentence describing what the agent just accomplished. Do not list individual clicks. Just the high-level semantic outcome. Respond ONLY with the sentence.',
          },
          {
            role: 'user' as const,
            content: `Condense these recent actions into one sentence:\n${actionText}`,
          },
        ],
        temperature: 0.1,
        maxTokens: 100,
        reasoningTier: 'fast' as const,
      };

      let summary = '';
      if (this.fastProvider.generateResponse) {
        const response = await this.fastProvider.generateResponse(request);
        summary = response.rawText?.trim() || '';
      } else {
        const decision = await this.fastProvider.generateDecision(request);
        summary = decision.reasoning_summary || 'Actions executed.';
      }

      this.logger?.debug('MemoryCompressor', `Compressed ${actions.length} actions into: ${summary}`);
      return summary || 'Performed sequence of interactions.';
    } catch (err) {
      this.logger?.warn('MemoryCompressor', `Failed to compress actions: ${err instanceof Error ? err.message : String(err)}`);
      return `Executed ${actions.length} recent actions.`;
    }
  }
}

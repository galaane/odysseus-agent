import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryCompressor } from '../../src/memory/MemoryCompressor.js';
import type { LLMProvider } from '../../src/llm/LLM.js';
import { Logger } from '../../src/logging/Logger.js';

describe('Phase 20: Memory Compressor', () => {
  let mockProvider: LLMProvider;
  let compressor: MemoryCompressor;
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger('error', () => {});
    
    mockProvider = {
      generateResponse: vi.fn(async () => ({
        rawText: 'The agent successfully filled the form and submitted it.',
        parsedDecision: {} as any,
      })),
      generateDecision: vi.fn(),
    };

    compressor = new MemoryCompressor(mockProvider, logger);
  });

  it('should compress multiple actions into a single string', async () => {
    const actions = [
      { step: 1, actionType: 'click', targetId: 'input_name', outcome: 'Success', summary: 'Click name' },
      { step: 2, actionType: 'type', targetId: 'input_name', outcome: 'Success', summary: 'Type John' },
      { step: 3, actionType: 'click', targetId: 'btn_submit', outcome: 'Success', summary: 'Submit form' },
    ];

    const result = await compressor.compressRecentActions(actions);
    
    expect(result).toBe('The agent successfully filled the form and submitted it.');
    expect(mockProvider.generateResponse).toHaveBeenCalledOnce();
  });

  it('should return empty string if no actions provided', async () => {
    const result = await compressor.compressRecentActions([]);
    expect(result).toBe('');
    expect(mockProvider.generateResponse).not.toHaveBeenCalled();
  });

  it('should fallback gracefully if provider throws', async () => {
    mockProvider.generateResponse = vi.fn().mockRejectedValue(new Error('API Down'));
    
    const actions = [
      { step: 1, actionType: 'click', targetId: 'input_name', outcome: 'Success', summary: 'Click name' },
    ];

    const result = await compressor.compressRecentActions(actions);
    expect(result).toBe('Executed 1 recent actions.');
  });
});

import { describe, it, expect } from 'vitest';
import { Planner } from '../../src/agent/Planner.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../src/llm/LLM.js';
import type { LLMDecision } from '../../src/llm/schemas.js';

describe('Dynamic LLM Planner Subsystem', () => {
  const planner = new Planner();

  it('should decompose goal dynamically when LLMProvider provides structured response', async () => {
    const mockProvider: LLMProvider = {
      async generateDecision(_request: LLMRequest): Promise<LLMDecision> {
        throw new Error('Not used in decomposition');
      },
      async generateResponse(_request: LLMRequest): Promise<LLMResponse> {
        return {
          rawText: JSON.stringify({
            milestones: [
              {
                step: 1,
                description: 'Open product comparison page',
                expectedOutcome: 'Comparison table visible with specifications',
              },
              {
                step: 2,
                description: 'Filter by battery life >= 12h',
                expectedOutcome: 'Filtered list displays matching models',
              },
              {
                step: 3,
                description: 'Extract top 3 models and pricing',
                expectedOutcome: 'Extracted models stored in findings',
              },
            ],
          }),
        };
      },
    };

    const plan = await planner.decomposeGoalWithLLM('Compare laptops with >12h battery', mockProvider);

    expect(plan.milestones.length).toBe(3);
    expect(plan.milestones[0].description).toBe('Open product comparison page');
    expect(plan.milestones[0].status).toBe('in_progress');
    expect(plan.milestones[1].status).toBe('pending');
    expect(plan.milestones[2].description).toContain('Extract top 3');
  });

  it('should fallback to deterministic initial plan when LLM is absent or fails', async () => {
    const plan = await planner.decomposeGoalWithLLM('Search for cheap flights to Tokyo');

    expect(plan.milestones.length).toBeGreaterThanOrEqual(3);
    expect(plan.milestones[0].status).toBe('in_progress');
    expect(plan.milestones[1].description).toContain('Locate relevant content');
  });

  it('should fallback to deterministic initial plan when LLM returns malformed JSON', async () => {
    const faultyProvider: LLMProvider = {
      async generateDecision(_request: LLMRequest): Promise<LLMDecision> {
        throw new Error('Not used');
      },
      async generateResponse(_request: LLMRequest): Promise<LLMResponse> {
        return {
          rawText: 'Sorry, I cannot produce JSON right now.',
        };
      },
    };

    const plan = await planner.decomposeGoalWithLLM('Find official company docs', faultyProvider);

    expect(plan.milestones.length).toBeGreaterThanOrEqual(3);
    expect(plan.milestones[0].description).toContain('Navigate to target');
  });
});

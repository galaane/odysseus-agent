import { describe, it, expect } from 'vitest';
import { LLMDecisionSchema, DeliberationSchema, validateDecision } from '../../src/llm/schemas.js';

describe('DeliberationSchema & Extended LLMDecisionSchema', () => {
  it('should validate structured deliberation attributes', () => {
    const validDeliberation = {
      observation_analysis: 'Search input is visible and focused. Results list has 10 items.',
      encountered_obstacles: ['Cookie consent banner partially obscuring footer.'],
      alternative_considered: 'Clicking pagination button directly.',
      risk_assessment: 'Clicking without closing cookie banner might trigger overlay interception.',
    };

    const parsed = DeliberationSchema.parse(validDeliberation);
    expect(parsed.observation_analysis).toBe(validDeliberation.observation_analysis);
    expect(parsed.encountered_obstacles).toEqual(validDeliberation.encountered_obstacles);
    expect(parsed.alternative_considered).toBe(validDeliberation.alternative_considered);
    expect(parsed.risk_assessment).toBe(validDeliberation.risk_assessment);
  });

  it('should accept decision with full deliberation object', () => {
    const rawDecision = {
      status: 'continue',
      deliberation: {
        observation_analysis: 'Product cards visible with prices.',
        encountered_obstacles: [],
        alternative_considered: 'Scroll down further.',
        risk_assessment: 'None.',
      },
      reasoning_summary: 'Clicking first product item to view pricing.',
      action: {
        type: 'click',
        targetId: 'el_001',
      },
      expectedOutcome: 'Product detail view opens.',
    };

    const decision = validateDecision(rawDecision);
    expect(decision.status).toBe('continue');
    expect(decision.deliberation?.observation_analysis).toBe('Product cards visible with prices.');
    expect(decision.reasoning_summary).toBe('Clicking first product item to view pricing.');
  });

  it('should preserve backward compatibility for decisions without deliberation', () => {
    const legacyDecision = {
      status: 'complete',
      reasoning_summary: 'Task finished successfully.',
      finalFindings: [
        {
          claim: 'Price is $499',
          sourceUrls: ['https://example.com/item'],
        },
      ],
    };

    const decision = validateDecision(legacyDecision);
    expect(decision.status).toBe('complete');
    expect(decision.deliberation).toBeUndefined();
    expect(decision.finalFindings?.[0].claim).toBe('Price is $499');
  });

  it('should validate waiting_human_intervention status', () => {
    const hitlDecision = {
      status: 'waiting_human_intervention',
      reasoning_summary: 'Cloudflare Turnstile CAPTCHA detected on screen.',
    };

    const decision = validateDecision(hitlDecision);
    expect(decision.status).toBe('waiting_human_intervention');
    expect(decision.reasoning_summary).toContain('CAPTCHA detected');
  });
});

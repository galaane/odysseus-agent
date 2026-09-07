import { describe, it, expect } from 'vitest';
import {
  LLMDecisionSchema,
  validateDecision,
  safeValidateDecision,
  FindingSchema,
} from '../../src/llm/schemas.js';
import { AgentError } from '../../src/agent/AgentError.js';
import { ErrorCodes } from '../../src/browser/BrowserError.js';

describe('LLM Decision Schemas', () => {
  it('should validate a valid continue decision with a browser action', () => {
    const validData = {
      status: 'continue',
      reasoning_summary: 'Target button found in observation snapshot.',
      action: {
        id: 'act_01',
        type: 'click',
        targetId: 'el_004',
      },
      expectedOutcome: 'Modal dialog should open.',
    };

    const decision = validateDecision(validData);
    expect(decision.status).toBe('continue');
    expect(decision.reasoning_summary).toBe('Target button found in observation snapshot.');
    expect(decision.action?.type).toBe('click');
    expect(decision.expectedOutcome).toBe('Modal dialog should open.');
  });

  it('should validate a complete decision with final findings', () => {
    const completeData = {
      status: 'complete',
      reasoning_summary: 'Product pricing retrieved from official table.',
      finalFindings: [
        {
          claim: 'Pro Plan costs $49 per month.',
          sourceUrls: ['https://example.com/pricing'],
          confidence: 0.95,
          notes: 'Annual billing option also available.',
        },
      ],
    };

    const decision = validateDecision(completeData);
    expect(decision.status).toBe('complete');
    expect(decision.finalFindings).toHaveLength(1);
    expect(decision.finalFindings?.[0].claim).toBe('Pro Plan costs $49 per month.');
  });

  it('should validate a blocked decision', () => {
    const blockedData = {
      status: 'blocked',
      reasoning_summary: 'Encountered external SMS MFA verification boundary.',
    };

    const decision = validateDecision(blockedData);
    expect(decision.status).toBe('blocked');
    expect(decision.reasoning_summary).toContain('SMS MFA');
  });

  it('should throw AgentError(LLM_INVALID_OUTPUT) when status is missing or invalid', () => {
    const invalidStatus = {
      status: 'pending_review',
      reasoning_summary: 'Waiting',
    };

    expect(() => validateDecision(invalidStatus)).toThrowError(AgentError);

    try {
      validateDecision(invalidStatus);
    } catch (err) {
      const aErr = err as AgentError;
      expect(aErr.code).toBe(ErrorCodes.LLM_INVALID_OUTPUT);
    }
  });

  it('should throw AgentError(LLM_INVALID_OUTPUT) when reasoning_summary is missing', () => {
    const missingReasoning = {
      status: 'continue',
      action: {
        type: 'wait',
        condition: 'timeout',
        timeoutMs: 1000,
      },
    };

    expect(() => validateDecision(missingReasoning)).toThrowError(AgentError);
  });

  it('should throw AgentError(LLM_INVALID_OUTPUT) when action is invalid', () => {
    const invalidAction = {
      status: 'continue',
      reasoning_summary: 'Trying invalid action',
      action: {
        type: 'execute_custom_js', // Invalid action type violating Invariant 6-7
        script: 'console.log(1)',
      },
    };

    expect(() => validateDecision(invalidAction)).toThrowError(AgentError);
  });

  it('should safely parse valid and invalid decisions with safeValidateDecision', () => {
    const valid = safeValidateDecision({
      status: 'continue',
      reasoning_summary: 'Valid action',
      action: { type: 'scroll', direction: 'down', amount: 300 },
    });
    expect(valid.success).toBe(true);

    const invalid = safeValidateDecision({
      status: 12345,
    });
    expect(invalid.success).toBe(false);
  });

  describe('FindingSchema', () => {
    it('should validate complete finding', () => {
      const finding = FindingSchema.parse({
        claim: 'CEO announced company founding year is 2012.',
        sourceUrls: ['https://example.com/about'],
        confidence: 0.9,
      });

      expect(finding.claim).toBe('CEO announced company founding year is 2012.');
      expect(finding.sourceUrls).toEqual(['https://example.com/about']);
      expect(finding.confidence).toBe(0.9);
    });

    it('should fail finding when confidence is out of [0, 1] range', () => {
      expect(() =>
        FindingSchema.parse({
          claim: 'Test claim',
          sourceUrls: [],
          confidence: 1.5,
        })
      ).toThrow();
    });
  });
});

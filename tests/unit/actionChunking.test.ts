import { describe, it, expect } from 'vitest';
import { LLMDecisionSchema } from '../../src/llm/schemas.js';

describe('Phase 20: Action Chunking Schema Validation', () => {
  it('should validate a single action', () => {
    const decision = {
      status: 'continue',
      reasoning_summary: 'Clicking button',
      action: { type: 'click', targetId: 'btn1' },
      expectedOutcome: 'Page loads',
    };
    const result = LLMDecisionSchema.safeParse(decision);
    expect(result.success).toBe(true);
  });

  it('should validate multiple actions in an array', () => {
    const decision = {
      status: 'continue',
      reasoning_summary: 'Filling form',
      actions: [
        { type: 'fill', targetId: 'user', value: 'admin' },
        { type: 'fill', targetId: 'pass', value: '1234' },
        { type: 'click', targetId: 'login_btn' },
      ],
      expectedOutcome: 'Logged in',
    };
    const result = LLMDecisionSchema.safeParse(decision);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.actions).toHaveLength(3);
      expect(result.data.actions?.[0].type).toBe('fill');
    }
  });

  it('should reject invalid actions in array', () => {
    const decision = {
      status: 'continue',
      reasoning_summary: 'Filling form',
      actions: [
        { type: 'fill', targetId: 'user', value: 'admin' },
        { type: 'invalid_action' },
      ],
      expectedOutcome: 'Logged in',
    };
    const result = LLMDecisionSchema.safeParse(decision);
    expect(result.success).toBe(false);
  });
});

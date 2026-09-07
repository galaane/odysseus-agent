import { describe, it, expect } from 'vitest';
import { ActionValidator, ActionValidationError } from '../../src/actions/ActionValidator.js';

describe('ActionValidator Subsystem', () => {
  it('should validate all 12 action types with valid payloads', () => {
    const validActions = [
      { type: 'navigate', url: 'https://example.com/login', waitUntil: 'networkidle' },
      { type: 'click', targetId: 'el_001' },
      { type: 'fill', targetId: 'el_002', value: 'admin@example.com' },
      { type: 'type', targetId: 'el_003', text: 'secret', delayMs: 50 },
      { type: 'press', key: 'Enter', targetId: 'el_004' },
      { type: 'scroll', direction: 'down', amount: 800 },
      { type: 'wait', condition: 'timeout', timeoutMs: 3000 },
      { type: 'screenshot', fullPage: true },
      { type: 'new_tab', url: 'https://other.org' },
      { type: 'switch_tab', tabId: 'tab_002' },
      { type: 'close_tab', tabId: 'tab_001' },
      { type: 'extract', targetId: 'el_005', instruction: 'Get price' },
    ];

    for (const action of validActions) {
      const validated = ActionValidator.validate(action);
      expect(validated.type).toBe(action.type);
      expect(validated.id).toBeDefined();
    }
  });

  it('should reject navigate action with invalid URL', () => {
    expect(() => {
      ActionValidator.validate({ type: 'navigate', url: 'not-a-valid-url' });
    }).toThrow(ActionValidationError);
  });

  it('should reject click action missing targetId', () => {
    expect(() => {
      ActionValidator.validate({ type: 'click' });
    }).toThrow(ActionValidationError);
  });

  it('should reject fill action missing value', () => {
    expect(() => {
      ActionValidator.validate({ type: 'fill', targetId: 'el_001' });
    }).toThrow(ActionValidationError);
  });

  it('should reject scroll action with invalid direction', () => {
    expect(() => {
      ActionValidator.validate({ type: 'scroll', direction: 'sideways' });
    }).toThrow(ActionValidationError);
  });

  it('should reject unknown action types', () => {
    expect(() => {
      ActionValidator.validate({ type: 'arbitrary_eval_js', code: 'alert(1)' });
    }).toThrow(ActionValidationError);
  });

  it('should return safe validation result object without throwing', () => {
    const ok = ActionValidator.safeValidate({ type: 'click', targetId: 'el_10' });
    expect(ok.success).toBe(true);

    const bad = ActionValidator.safeValidate({ type: 'unknown_type' });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error).toBeInstanceOf(ActionValidationError);
    }
  });
});

import { describe, it, expect } from 'vitest';
import { BrowserError, ErrorCodes } from '../../src/browser/BrowserError.js';
import { AgentError } from '../../src/agent/AgentError.js';

describe('Error Taxonomy Subsystem', () => {
  describe('BrowserError', () => {
    it('should create error with correct code and context', () => {
      const err = new BrowserError(ErrorCodes.ELEMENT_NOT_FOUND, 'Target element not located on page', {
        targetId: 'el_042',
        selector: 'button#submit',
      });

      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(BrowserError);
      expect(err.name).toBe('BrowserError');
      expect(err.code).toBe('ELEMENT_NOT_FOUND');
      expect(err.message).toBe('Target element not located on page');
      expect(err.context?.targetId).toBe('el_042');
    });

    it('should serialize cleanly to JSON via toJSON()', () => {
      const err = new BrowserError(ErrorCodes.NAVIGATION_TIMEOUT, 'Navigation exceeded 30000ms', {
        url: 'https://example.com',
      });

      const serialized = err.toJSON();
      expect(serialized.name).toBe('BrowserError');
      expect(serialized.code).toBe(ErrorCodes.NAVIGATION_TIMEOUT);
      expect(serialized.message).toBe('Navigation exceeded 30000ms');
      expect(serialized.context?.url).toBe('https://example.com');
      expect(serialized.stack).toBeDefined();

      const jsonString = JSON.stringify(err.toJSON());
      const parsed = JSON.parse(jsonString);
      expect(parsed.code).toBe('NAVIGATION_TIMEOUT');
    });
  });

  describe('AgentError', () => {
    it('should create agent error with correct code and context', () => {
      const err = new AgentError(ErrorCodes.TASK_TIMEOUT, 'Task exceeded maximum allowed steps', {
        stepCount: 100,
        maxSteps: 100,
      });

      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(AgentError);
      expect(err.name).toBe('AgentError');
      expect(err.code).toBe('TASK_TIMEOUT');
      expect(err.context?.stepCount).toBe(100);

      const json = err.toJSON();
      expect(json.name).toBe('AgentError');
      expect(json.code).toBe('TASK_TIMEOUT');
    });
  });
});

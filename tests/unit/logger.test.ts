import { describe, it, expect, vi } from 'vitest';
import { Logger, redactSecrets, type LogEntry } from '../../src/logging/Logger.js';
import { EventLogger } from '../../src/logging/EventLogger.js';
import { Trace } from '../../src/logging/Trace.js';

describe('Logging & Secret Redaction Subsystem', () => {
  describe('redactSecrets function', () => {
    it('should mask sensitive dictionary keys', () => {
      const input = {
        username: 'agent_user',
        password: 'super_secret_password',
        token: 'xyz_token_123',
        authorization: 'Basic dXNlcjpwYXNz',
        metadata: {
          apiKey: 'secret_api_key',
          safeField: 'hello world',
        },
      };

      const redacted = redactSecrets(input) as Record<string, any>;
      expect(redacted.username).toBe('agent_user');
      expect(redacted.password).toBe('[REDACTED]');
      expect(redacted.token).toBe('[REDACTED]');
      expect(redacted.authorization).toBe('[REDACTED]');
      expect(redacted.metadata.apiKey).toBe('[REDACTED]');
      expect(redacted.metadata.safeField).toBe('hello world');
    });

    it('should mask Bearer tokens within text strings', () => {
      const text = 'User request with Bearer secret-token-abcdef.123456.xyz in header';
      const sanitized = redactSecrets(text);
      expect(sanitized).toBe('User request with Bearer [REDACTED] in header');
    });

    it('should mask sensitive cookie values within strings', () => {
      const cookieStr = 'connect.sid=s%3AvkR4k1245; path=/; HttpOnly; jwt=eyJhbGciOi';
      const sanitized = redactSecrets(cookieStr);
      expect(sanitized).toBe('connect.sid=[REDACTED]; path=/; HttpOnly; jwt=[REDACTED]');
    });

    it('should mask OpenAI-style API keys in strings', () => {
      const text = 'Calling OpenAI using key sk-1234567890abcdef1234567890';
      const sanitized = redactSecrets(text);
      expect(sanitized).toBe('Calling OpenAI using key [REDACTED_API_KEY]');
    });

    it('should handle arrays with mixed sensitive elements', () => {
      const arr = ['safe', { password: 'secret_pwd' }, 'Bearer token123'];
      const sanitized = redactSecrets(arr) as any[];
      expect(sanitized[0]).toBe('safe');
      expect(sanitized[1].password).toBe('[REDACTED]');
      expect(sanitized[2]).toBe('Bearer [REDACTED]');
    });
  });

  describe('Logger instance', () => {
    it('should format logs as valid NDJSON with required fields', () => {
      const capturedEntries: LogEntry[] = [];
      const capturedLines: string[] = [];

      const logger = new Logger('debug', (entry, jsonLine) => {
        capturedEntries.push(entry);
        capturedLines.push(jsonLine);
      });

      logger.info('TestComponent', 'Action completed successfully', { steps: 5 }, { taskId: 'task_001', actionId: 'act_10' });

      expect(capturedEntries).toHaveLength(1);
      const entry = capturedEntries[0];
      expect(entry.component).toBe('TestComponent');
      expect(entry.message).toBe('Action completed successfully');
      expect(entry.level).toBe('info');
      expect(entry.taskId).toBe('task_001');
      expect(entry.actionId).toBe('act_10');
      expect(entry.metadata?.steps).toBe(5);

      // Verify valid JSON line
      const parsed = JSON.parse(capturedLines[0]);
      expect(parsed.component).toBe('TestComponent');
      expect(parsed.timestamp).toBeDefined();
    });

    it('should respect configured log level thresholds', () => {
      const captured: LogEntry[] = [];
      const logger = new Logger('warn', (entry) => {
        captured.push(entry);
      });

      logger.debug('Comp', 'debug message');
      logger.info('Comp', 'info message');
      logger.warn('Comp', 'warn message');
      logger.error('Comp', 'error message');

      expect(captured).toHaveLength(2);
      expect(captured[0].level).toBe('warn');
      expect(captured[1].level).toBe('error');
    });

    it('should automatically redact sensitive data passed to logger', () => {
      const captured: LogEntry[] = [];
      const logger = new Logger('info', (entry) => {
        captured.push(entry);
      });

      logger.info('AuthService', 'User login attempted with Bearer token_secret_123', {
        password: 'plain_password',
        status: 'pending',
      });

      expect(captured).toHaveLength(1);
      expect(captured[0].message).toContain('Bearer [REDACTED]');
      expect(captured[0].metadata?.password).toBe('[REDACTED]');
      expect(captured[0].metadata?.status).toBe('pending');
    });
  });

  describe('EventLogger', () => {
    it('should emit structured domain events', () => {
      const captured: LogEntry[] = [];
      const logger = new Logger('info', (entry) => {
        captured.push(entry);
      });
      const eventLogger = new EventLogger(logger);

      eventLogger.emit('browser.started', { profile: 'persistent' }, { taskId: 'task_abc' });
      eventLogger.emit('agent.failed', { reason: 'timeout' }, { taskId: 'task_abc' });

      expect(captured).toHaveLength(2);
      expect(captured[0].metadata?.event).toBe('browser.started');
      expect(captured[0].level).toBe('info');
      expect(captured[1].metadata?.event).toBe('agent.failed');
      expect(captured[1].level).toBe('error');
    });
  });

  describe('Trace', () => {
    it('should measure span duration correctly', async () => {
      const captured: LogEntry[] = [];
      const logger = new Logger('debug', (entry) => {
        captured.push(entry);
      });
      const trace = new Trace(logger);

      const span = trace.startSpan('ActionExecution', { actionType: 'click' });
      await new Promise((resolve) => setTimeout(resolve, 20));
      const durationMs = span.end({ success: true });

      expect(durationMs).toBeGreaterThanOrEqual(15);
      expect(captured).toHaveLength(2);
      expect(captured[0].message).toContain('Span started: ActionExecution');
      expect(captured[1].message).toContain('Span finished: ActionExecution');
      expect(captured[1].metadata?.durationMs).toBe(durationMs);
      expect(captured[1].metadata?.success).toBe(true);
    });
  });
});

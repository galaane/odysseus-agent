import { type ErrorCode, type ErrorSerialized } from '../browser/BrowserError.js';

export class AgentError extends Error {
  public readonly code: ErrorCode;
  public readonly context?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = 'AgentError';
    this.code = code;
    this.context = context;
    Object.setPrototypeOf(this, AgentError.prototype);
  }

  public toJSON(): ErrorSerialized {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      stack: this.stack,
    };
  }
}

export const ErrorCodes = {
  BROWSER_NOT_CONNECTED: 'BROWSER_NOT_CONNECTED',
  BROWSER_CRASHED: 'BROWSER_CRASHED',
  BROWSER_ALREADY_RUNNING: 'BROWSER_ALREADY_RUNNING',
  PAGE_TIMEOUT: 'PAGE_TIMEOUT',
  NAVIGATION_TIMEOUT: 'NAVIGATION_TIMEOUT',
  ELEMENT_NOT_FOUND: 'ELEMENT_NOT_FOUND',
  ELEMENT_NOT_VISIBLE: 'ELEMENT_NOT_VISIBLE',
  ELEMENT_NOT_INTERACTABLE: 'ELEMENT_NOT_INTERACTABLE',
  STALE_ELEMENT: 'STALE_ELEMENT',
  FRAME_NOT_FOUND: 'FRAME_NOT_FOUND',
  DOWNLOAD_FAILED: 'DOWNLOAD_FAILED',
  POPUP_TIMEOUT: 'POPUP_TIMEOUT',
  ACTION_TIMEOUT: 'ACTION_TIMEOUT',
  LLM_TIMEOUT: 'LLM_TIMEOUT',
  LLM_INVALID_OUTPUT: 'LLM_INVALID_OUTPUT',
  TASK_TIMEOUT: 'TASK_TIMEOUT',
  TASK_CANCELLED: 'TASK_CANCELLED',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  AUTH_FAILED: 'AUTH_FAILED',
  VERIFICATION_REQUIRED: 'VERIFICATION_REQUIRED',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export interface ErrorSerialized {
  name: string;
  code: ErrorCode;
  message: string;
  context?: Record<string, unknown>;
  stack?: string;
}

export class BrowserError extends Error {
  public readonly code: ErrorCode;
  public readonly context?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = 'BrowserError';
    this.code = code;
    this.context = context;
    Object.setPrototypeOf(this, BrowserError.prototype);
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

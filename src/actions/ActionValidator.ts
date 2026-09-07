import { z } from 'zod';
import { BrowserActionSchema, type BrowserAction } from './Action.js';

export class ActionValidationError extends Error {
  constructor(message: string, public readonly issues: z.ZodIssue[]) {
    super(message);
    this.name = 'ActionValidationError';
  }
}

export class ActionValidator {
  /**
   * Validates a raw action object against the BrowserAction discriminated union schema.
   * Throws ActionValidationError if invalid.
   */
  public static validate(rawAction: unknown): BrowserAction {
    const result = BrowserActionSchema.safeParse(rawAction);
    if (!result.success) {
      const issueDetails = result.error.issues
        .map((issue) => `[${issue.path.join('.')}] ${issue.message}`)
        .join(', ');
      throw new ActionValidationError(`Action validation failed: ${issueDetails}`, result.error.issues);
    }
    return result.data;
  }

  /**
   * Safely validates a raw action object, returning a result object instead of throwing.
   */
  public static safeValidate(rawAction: unknown):
    | { success: true; data: BrowserAction }
    | { success: false; error: ActionValidationError } {
    const result = BrowserActionSchema.safeParse(rawAction);
    if (!result.success) {
      const issueDetails = result.error.issues
        .map((issue) => `[${issue.path.join('.')}] ${issue.message}`)
        .join(', ');
      return {
        success: false,
        error: new ActionValidationError(`Action validation failed: ${issueDetails}`, result.error.issues),
      };
    }
    return { success: true, data: result.data };
  }
}

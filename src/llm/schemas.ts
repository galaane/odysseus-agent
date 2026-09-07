import { z } from 'zod';
import { BrowserActionSchema } from '../actions/Action.js';
import { AgentError } from '../agent/AgentError.js';
import { ErrorCodes } from '../browser/BrowserError.js';

export const FindingSchema = z.object({
  claim: z.string(),
  sourceUrls: z.array(z.string()),
  confidence: z.number().min(0).max(1).optional(),
  notes: z.string().optional(),
});

export type Finding = z.infer<typeof FindingSchema>;

export const DeliberationSchema = z.object({
  observation_analysis: z.string().describe('Detailed breakdown of what is currently on the screen and changes since last step.'),
  encountered_obstacles: z.array(z.string()).optional().describe('Overlays, disabled controls, or missing elements detected.'),
  alternative_considered: z.string().optional().describe('Alternative actions evaluated before deciding.'),
  risk_assessment: z.string().optional().describe('Potential risks or preconditions of this action.'),
});

export type Deliberation = z.infer<typeof DeliberationSchema>;

export const ActionCandidateSchema = z.object({
  action: BrowserActionSchema,
  reasoning: z.string().describe('Reasoning for this candidate action'),
  confidence: z.number().min(0).max(1).default(0.8).describe('Estimated confidence / success probability (0.0 to 1.0)'),
  riskScore: z.number().min(0).max(1).optional().describe('Estimated risk score if known (0.0 to 1.0)'),
  expectedOutcome: z.string().optional(),
});

export type ActionCandidate = z.infer<typeof ActionCandidateSchema>;

export const LLMDecisionSchema = z.object({
  status: z.enum(['continue', 'complete', 'blocked', 'waiting_human_intervention']),
  deliberation: DeliberationSchema.optional(),
  reasoning_summary: z.string().describe('Short explanation of why this action was chosen based on the observation.'),
  action: BrowserActionSchema.optional(),
  actions: z.array(BrowserActionSchema).optional().describe('Optional array of multiple actions to execute in sequence (Action Chunking) without waiting for new DOM observation, provided no page navigation occurs.'),
  candidates: z.array(ActionCandidateSchema).optional().describe('Sampled action alternatives evaluated in Best-of-N speculative sampling.'),
  expectedOutcome: z.string().optional().describe('What page state change is expected after this action(s).'),
  finalFindings: z.array(FindingSchema).optional(),
});

export type LLMDecision = z.infer<typeof LLMDecisionSchema>;

/**
 * Validates unknown data against the LLMDecisionSchema.
 * Throws AgentError(LLM_INVALID_OUTPUT) if validation fails.
 */
export function validateDecision(data: unknown): LLMDecision {
  const result = LLMDecisionSchema.safeParse(data);
  if (!result.success) {
    const errorDetails = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
    throw new AgentError(
      ErrorCodes.LLM_INVALID_OUTPUT,
      `Invalid LLM decision schema: ${errorDetails}`,
      { issues: result.error.errors, data }
    );
  }
  return result.data;
}

/**
 * Safely parses unknown data against the LLMDecisionSchema without throwing.
 */
export function safeValidateDecision(data: unknown): z.SafeParseReturnType<unknown, LLMDecision> {
  return LLMDecisionSchema.safeParse(data);
}

import { z } from 'zod';
import type { LLMProvider } from '../llm/LLM.js';

export interface PlanMilestone {
  step: number;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  expectedOutcome?: string;
}

export const PlanMilestoneSchema = z.object({
  step: z.number().optional(),
  description: z.string(),
  expectedOutcome: z.string().optional(),
});

export const PlanDecompositionSchema = z.object({
  milestones: z.array(PlanMilestoneSchema).min(1).max(6),
});

export type PlanDecomposition = z.infer<typeof PlanDecompositionSchema>;

export interface Plan {
  goal: string;
  milestones: PlanMilestone[];
  currentMilestoneIndex: number;
  lastUpdated: string;
}

export class Planner {
  /**
   * Decomposes a task goal dynamically using an LLMProvider when available,
   * falling back cleanly to deterministic heuristic planning.
   */
  public async decomposeGoalWithLLM(goal: string, llmProvider?: LLMProvider): Promise<Plan> {
    if (!llmProvider || !llmProvider.generateResponse) {
      return this.createInitialPlan(goal);
    }

    try {
      const response = await llmProvider.generateResponse({
        messages: [
          {
            role: 'system',
            content:
              'You are Odysseus, a strategic planner for an autonomous web browser agent. Decompose the user goal into 2 to 5 sequential, realistic browser milestones. Respond ONLY with a JSON object: { "milestones": [{ "step": 1, "description": "...", "expectedOutcome": "..." }] }',
          },
          {
            role: 'user',
            content: `Decompose this goal into concise milestones: "${goal}"`,
          },
        ],
        temperature: 0.2,
        responseFormat: 'json_object',
        reasoningTier: 'deep',
      });

      if (response.rawText) {
        const parsed = JSON.parse(response.rawText);
        const result = PlanDecompositionSchema.safeParse(parsed);
        if (result.success && result.data.milestones.length > 0) {
          const milestones: PlanMilestone[] = result.data.milestones.map((m, idx) => ({
            step: idx + 1,
            description: m.description,
            status: idx === 0 ? 'in_progress' : 'pending',
            expectedOutcome: m.expectedOutcome || 'Milestone state achieved.',
          }));

          return {
            goal,
            milestones,
            currentMilestoneIndex: 0,
            lastUpdated: new Date().toISOString(),
          };
        }
      }
    } catch {
      // Fallback seamlessly to deterministic plan
    }

    return this.createInitialPlan(goal);
  }
  /**
   * Formulates an initial short-horizon 1-4 milestone plan based on the goal.
   */
  public createInitialPlan(goal: string): Plan {
    const goalLower = goal.toLowerCase();
    const milestones: PlanMilestone[] = [];

    // Milestone 1: Navigation / Access
    milestones.push({
      step: 1,
      description: 'Navigate to target domain or relevant entry point.',
      status: 'in_progress',
      expectedOutcome: 'Target page loaded with interactive elements visible.',
    });

    // Milestone 2: Locate target view or form
    if (goalLower.includes('login') || goalLower.includes('sign in') || goalLower.includes('register')) {
      milestones.push({
        step: 2,
        description: 'Locate authentication form fields and fill credentials.',
        status: 'pending',
        expectedOutcome: 'Form submitted and authentication session established.',
      });
    } else if (goalLower.includes('search') || goalLower.includes('find') || goalLower.includes('pricing')) {
      milestones.push({
        step: 2,
        description: 'Locate relevant content section, search input, or navigation links.',
        status: 'pending',
        expectedOutcome: 'Target content or search results displayed.',
      });
    } else {
      milestones.push({
        step: 2,
        description: 'Interact with page controls to reach desired application state.',
        status: 'pending',
        expectedOutcome: 'Application state updated.',
      });
    }

    // Milestone 3: Information extraction or interaction execution
    milestones.push({
      step: 3,
      description: 'Extract required data, confirm state change, or complete primary workflow.',
      status: 'pending',
      expectedOutcome: 'Target workflow executed with verified empirical evidence.',
    });

    // Milestone 4: Final verification and synthesis
    milestones.push({
      step: 4,
      description: 'Synthesize findings, verify goal completion evidence, and complete task.',
      status: 'pending',
      expectedOutcome: 'Goal completed with validated findings.',
    });

    return {
      goal,
      milestones,
      currentMilestoneIndex: 0,
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Advances the current milestone based on evaluation outcome.
   */
  public advanceMilestone(plan: Plan, success: boolean): Plan {
    const current = plan.milestones[plan.currentMilestoneIndex];
    if (current) {
      current.status = success ? 'completed' : 'failed';
    }

    if (success && plan.currentMilestoneIndex < plan.milestones.length - 1) {
      plan.currentMilestoneIndex++;
      plan.milestones[plan.currentMilestoneIndex].status = 'in_progress';
    }

    plan.lastUpdated = new Date().toISOString();
    return plan;
  }

  /**
   * Dynamically adapts the plan when page state diverges or an unexpected barrier arises.
   * If forceStrategyPivot is true, injects a critical milestone instructing the LLM to completely abandon its previous approach.
   */
  public replan(plan: Plan, divergenceReason: string, forceStrategyPivot = false): Plan {
    const currentIndex = plan.currentMilestoneIndex;
    const current = plan.milestones[currentIndex];

    if (current) {
      current.status = 'failed';
    }

    let description = `Adapt strategy: ${divergenceReason}`;
    let expectedOutcome = 'Page barrier cleared or alternative path discovered.';

    if (forceStrategyPivot) {
      description = `CRITICAL PIVOT: ${divergenceReason} ABANDON PREVIOUS APPROACH. The current logical path is a dead end. Do NOT interact with the previous elements. Discover a fundamentally different navigation path or tool.`;
      expectedOutcome = 'Alternative strategy successfully identified and executed.';
    }

    const adaptationMilestone: PlanMilestone = {
      step: plan.milestones.length + 1,
      description,
      status: 'in_progress',
      expectedOutcome,
    };

    // Insert adaptation milestone after current
    plan.milestones.splice(currentIndex + 1, 0, adaptationMilestone);
    plan.currentMilestoneIndex = currentIndex + 1;
    plan.lastUpdated = new Date().toISOString();

    return plan;
  }

  /**
   * Retrieves the active milestone.
   */
  public getCurrentMilestone(plan: Plan): PlanMilestone | undefined {
    return plan.milestones[plan.currentMilestoneIndex];
  }

  /**
   * Formats the plan into a concise summary string for prompt context.
   */
  public formatPlanSummary(plan: Plan): string {
    const lines = plan.milestones.map((m, idx) => {
      const isCurrent = idx === plan.currentMilestoneIndex ? ' [ACTIVE]' : '';
      return `${m.step}. [${m.status}] ${m.description}${isCurrent}`;
    });
    return lines.join('\n');
  }
}

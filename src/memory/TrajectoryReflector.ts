import type { LLMProvider } from '../llm/LLM.js';
import type { DomainPlaybookRepository } from '../persistence/DomainPlaybookRepository.js';
import type { ActionRepository } from '../persistence/ActionRepository.js';
import type { Logger } from '../logging/Logger.js';
import type { Source, AgentResult } from '../agent/Agent.js';

export interface TrajectoryReflectionInput {
  taskId: string;
  goal: string;
  status: AgentResult['status'];
  summary: string;
  sources?: Source[];
  steps: number;
}

export interface LearnedRule {
  rule: string;
  category: 'navigation' | 'form_fill' | 'modal_handling' | 'search' | 'general';
  confidence: number;
}

export interface TrajectoryReflection {
  domain: string;
  status: string;
  evaluationSummary: string;
  learnedRules: LearnedRule[];
  antiPatterns: string[];
}

export interface TrajectoryReflectorOptions {
  llmProvider: LLMProvider;
  playbookRepo?: DomainPlaybookRepository;
  actionRepo?: ActionRepository;
  logger: Logger;
}

export class TrajectoryReflector {
  private llmProvider: LLMProvider;
  private playbookRepo?: DomainPlaybookRepository;
  private actionRepo?: ActionRepository;
  private logger: Logger;

  constructor(options: TrajectoryReflectorOptions) {
    this.llmProvider = options.llmProvider;
    this.playbookRepo = options.playbookRepo;
    this.actionRepo = options.actionRepo;
    this.logger = options.logger;
  }

  /**
   * Performs post-task metacognitive reflection on the trajectory.
   * Evaluates all tasks, weighting failures with deeper diagnostic scrutiny.
   */
  public async reflectOnTask(input: TrajectoryReflectionInput): Promise<TrajectoryReflection | undefined> {
    const isFailure = input.status !== 'completed';
    const primaryDomain = this.resolvePrimaryDomain(input);

    if (!primaryDomain) {
      this.logger.debug('TrajectoryReflector', 'Skipping reflection: no target domain identified.');
      return undefined;
    }

    this.logger.info(
      'TrajectoryReflector',
      `Starting post-task reflection for task ${input.taskId} on ${primaryDomain} (status: ${input.status}, deepWeight: ${isFailure})`
    );

    // Retrieve full action trace from ActionRepository if available
    const actions = this.actionRepo ? this.actionRepo.getActionsForTask(input.taskId) : [];
    const formattedTrace = actions.length > 0
      ? actions
          .map((a) => {
            const outcome = a.success ? 'success' : `FAILED (${a.error_code || 'error'}: ${a.error_message || ''})`;
            return `Step ${a.step_index}: ${a.action_type} -> ${outcome}`;
          })
          .join('\n')
      : `Executed ${input.steps} steps without granular action records.`;

    const failureGuidance = isFailure
      ? `DEEP FAILURE DIAGNOSTIC DIRECTIVE:
This task encountered problems and did NOT complete successfully (status: ${input.status}, summary: "${input.summary}").
Analyze the root causes of failure. Identify what specific UI patterns, elements, or assumptions failed, and formulate strict anti-patterns and rules to avoid this mistake on ${primaryDomain} in the future.`
      : `SUCCESS HEURISTIC DIRECTIVE:
This task succeeded (status: ${input.status}). Extract effective shortcuts and procedural heuristics for ${primaryDomain} that will accelerate future visits.`;

    const systemPrompt = `You are a metacognitive browser agent reflection specialist.
${failureGuidance}

Respond in strict JSON format:
{
  "domain": "${primaryDomain}",
  "status": "${input.status}",
  "evaluationSummary": "<Analysis of what worked or caused failure>",
  "learnedRules": [
    {
      "rule": "<Actionable heuristic rule for this domain>",
      "category": "navigation" | "form_fill" | "modal_handling" | "search" | "general",
      "confidence": 0.8
    }
  ],
  "antiPatterns": [
    "<Mistakes or actions to NEVER repeat on this domain>"
  ]
}`;

    const userPrompt = `Task Goal: "${input.goal}"
Target Domain: ${primaryDomain}
Final Status: ${input.status}
Final Summary: ${input.summary}

Trajectory Action Trace:
${formattedTrace}`;

    try {
      const response = await this.llmProvider.generateDecision({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
        maxTokens: isFailure ? 800 : 400,
        reasoningTier: isFailure ? 'deep' : 'fast',
      });

      let parsed: TrajectoryReflection | undefined;

      if (response.reasoning_summary) {
        try {
          const match = response.reasoning_summary.match(/\{[\s\S]*\}/);
          if (match) {
            parsed = JSON.parse(match[0]) as TrajectoryReflection;
          }
        } catch {
          // Soft fail JSON extraction from reasoning summary
        }
      }

      if (!parsed) {
        parsed = {
          domain: primaryDomain,
          status: input.status,
          evaluationSummary: response.reasoning_summary || input.summary,
          learnedRules: isFailure
            ? [
                {
                  rule: `Avoid repeating previous approach for ${input.goal.slice(0, 40)}: encountered ${input.status}`,
                  category: 'general',
                  confidence: 0.7,
                },
              ]
            : [
                {
                  rule: `Follow successful path for ${input.goal.slice(0, 40)}`,
                  category: 'general',
                  confidence: 0.8,
                },
              ],
          antiPatterns: isFailure ? [`Failed strategy on ${primaryDomain} due to ${input.summary}`] : [],
        };
      }

      // Persist learned rules to DomainPlaybookRepository
      if (this.playbookRepo && parsed.learnedRules && parsed.learnedRules.length > 0) {
        for (const r of parsed.learnedRules) {
          if (r.confidence >= 0.5) {
            this.playbookRepo.savePlaybook({
              id: `pb_${primaryDomain.replace(/[^a-zA-Z0-9]/g, '_')}_refl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              domain: primaryDomain,
              pattern_type: 'reflexion_heuristic',
              pattern_key: r.rule.slice(0, 60),
              playbook_data: JSON.stringify({
                category: r.category,
                rule: r.rule,
                confidence: r.confidence,
                taskStatus: input.status,
                learnedFromTaskId: input.taskId,
              }),
              last_applied_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
            });
          }
        }
      }

      this.logger.info('TrajectoryReflector', `Reflection completed for ${primaryDomain}`, {
        rulesLearned: parsed.learnedRules?.length || 0,
        antiPatternsCount: parsed.antiPatterns?.length || 0,
      });

      return parsed;
    } catch (err) {
      this.logger.warn('TrajectoryReflector', `Reflection generation failed: ${String(err)}`);
      return undefined;
    }
  }

  private resolvePrimaryDomain(input: TrajectoryReflectionInput): string | undefined {
    if (input.sources && input.sources.length > 0) {
      for (const s of input.sources) {
        try {
          const hostname = new URL(s.url).hostname;
          if (hostname && hostname !== 'about:blank') {
            return hostname;
          }
        } catch {
          // Ignore
        }
      }
    }

    const urlMatch = input.summary.match(/https?:\/\/([^/\s]+)/);
    if (urlMatch) {
      return urlMatch[1];
    }

    return undefined;
  }
}

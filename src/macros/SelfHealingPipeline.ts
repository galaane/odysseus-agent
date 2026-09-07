import type { ElementRegistry, RegisteredElement } from '../observer/ElementRegistry.js';
import type { WorkflowMacroRepository } from '../persistence/WorkflowMacroRepository.js';
import type { LLMProvider } from '../llm/LLM.js';
import type { ParameterizedMacroStep, MacroHealingResult, WorkflowMacro } from './types.js';
import type { Logger } from '../logging/Logger.js';

export class SelfHealingPipeline {
  constructor(
    private readonly macroRepo?: WorkflowMacroRepository,
    private readonly llmProvider?: LLMProvider,
    private readonly logger?: Logger
  ) {}

  /**
   * Attempts to heal a failing macro step by discovering the relocated or updated target element.
   */
  public async healStep(
    macro: WorkflowMacro,
    failedStepIndex: number,
    elementRegistry: ElementRegistry
  ): Promise<MacroHealingResult> {
    const step = macro.steps[failedStepIndex];
    if (!step) {
      return { healed: false, tierUsed: 'none', reason: 'Invalid step index' };
    }

    const elements = elementRegistry.getAll();
    if (elements.length === 0) {
      return { healed: false, tierUsed: 'none', reason: 'Registry is empty in current snapshot' };
    }

    this.logger?.info(
      'SelfHealingPipeline',
      `Initiating self-healing for macro [${macro.id}] step #${step.stepNumber} (target: [${step.primaryTargetRole || 'any'}] "${step.primaryTargetName || step.primaryTargetId}")`
    );

    // Tier 1: Semantic Heuristic Matching
    const heuristicMatch = this.findHeuristicMatch(step, elements);
    if (heuristicMatch) {
      const updatedStep = this.createUpdatedStep(step, heuristicMatch);
      this.persistHealedMacro(macro, failedStepIndex, updatedStep);

      this.logger?.info(
        'SelfHealingPipeline',
        `Tier 1 Heuristic repair succeeded for step #${step.stepNumber}: re-anchored to [${heuristicMatch.id}] "${heuristicMatch.name}"`
      );

      return {
        healed: true,
        repairedTargetId: heuristicMatch.id,
        tierUsed: 'heuristic',
        updatedStep,
        reason: `Matched semantic role "${heuristicMatch.role}" and name "${heuristicMatch.name}"`,
      };
    }

    // Tier 2: Focused LLM Micro-Repair
    if (this.llmProvider) {
      try {
        const llmMatch = await this.queryLLMRepair(step, elements);
        if (llmMatch) {
          const updatedStep = this.createUpdatedStep(step, llmMatch);
          this.persistHealedMacro(macro, failedStepIndex, updatedStep);

          this.logger?.info(
            'SelfHealingPipeline',
            `Tier 2 LLM repair succeeded for step #${step.stepNumber}: mapped to [${llmMatch.id}] "${llmMatch.name}"`
          );

          return {
            healed: true,
            repairedTargetId: llmMatch.id,
            tierUsed: 'llm',
            updatedStep,
            reason: 'Resolved via focused LLM micro-repair',
          };
        }
      } catch (err: unknown) {
        this.logger?.warn('SelfHealingPipeline', `Tier 2 LLM repair error: ${String(err)}`);
      }
    }

    this.logger?.warn(
      'SelfHealingPipeline',
      `Self-healing failed for macro [${macro.id}] step #${step.stepNumber}. Degrading macro status.`
    );
    if (this.macroRepo) {
      this.macroRepo.recordFailure(macro.id);
    }

    return {
      healed: false,
      tierUsed: 'none',
      reason: 'No confident replacement element found across Heuristic and LLM tiers',
    };
  }

  private findHeuristicMatch(
    step: ParameterizedMacroStep,
    elements: RegisteredElement[]
  ): RegisteredElement | undefined {
    const targetRole = step.primaryTargetRole?.toLowerCase();
    const targetName = step.primaryTargetName?.toLowerCase().trim();
    const fallbacks = (step.fallbackSelectors || []).map((s) => s.toLowerCase());

    let bestScore = 0;
    let bestMatch: RegisteredElement | undefined;

    for (const el of elements) {
      const elRole = el.role.toLowerCase();
      const elName = el.name.toLowerCase().trim();
      let score = 0;

      // 1. Exact role and exact name
      if (targetRole && elRole === targetRole && targetName && elName === targetName) {
        score = 1.0;
      }
      // 2. Exact name match (different or generic role)
      else if (targetName && elName === targetName) {
        score = 0.90;
      }
      // 3. Fallback selector match
      else if (fallbacks.some((fb) => el.locatorStrategy.selector.toLowerCase().includes(fb))) {
        score = 0.85;
      }
      // 4. Token overlap in accessible name with matching role
      else if (targetName && targetRole && elRole === targetRole && targetName.length >= 3) {
        const targetTokens = targetName.split(/\s+/);
        const elTokens = new Set(elName.split(/\s+/));
        const matchedTokens = targetTokens.filter((t) => elTokens.has(t));
        const overlapRatio = matchedTokens.length / targetTokens.length;

        if (overlapRatio >= 0.6) {
          score = 0.70 + overlapRatio * 0.15;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = el;
      }
    }

    return bestScore >= 0.75 ? bestMatch : undefined;
  }

  private async queryLLMRepair(
    step: ParameterizedMacroStep,
    elements: RegisteredElement[]
  ): Promise<RegisteredElement | undefined> {
    if (!this.llmProvider) return undefined;

    const candidateSummary = elements
      .slice(0, 30)
      .map((el) => `- ID: ${el.id}, Role: "${el.role}", Name: "${el.name}"`)
      .join('\n');

    const prompt = `A deterministic browser macro step failed because its target element was not found.
Missing Target:
- Expected Role: "${step.primaryTargetRole || 'unknown'}"
- Expected Name/Label: "${step.primaryTargetName || 'unknown'}"

Currently visible candidate elements:
${candidateSummary}

Identify which candidate element ID is the intended replacement for the missing target.
Respond with a JSON object strictly matching:
{ "repairedTargetId": "el_XXX", "confidence": 0.9 }
If no candidate clearly matches the intended element, return { "repairedTargetId": null, "confidence": 0.0 }`;

    let rawText = '';
    if (typeof this.llmProvider.generateResponse === 'function') {
      const response = await this.llmProvider.generateResponse({
        messages: [
          { role: 'system', content: 'You are a precise browser automation element repair subsystem. Respond only with JSON.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
      });
      rawText = response.rawText;
    } else {
      const decision = await this.llmProvider.generateDecision({
        messages: [
          { role: 'system', content: 'You are a precise browser automation element repair subsystem. Respond only with JSON in reasoning_summary.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
      });
      rawText = decision.reasoning_summary;
    }

    try {
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]) as { repairedTargetId: string | null; confidence: number };
        if (parsed.repairedTargetId && parsed.confidence >= 0.75) {
          return elements.find((el) => el.id === parsed.repairedTargetId);
        }
      }
    } catch {
      // Soft fail JSON parse
    }

    return undefined;
  }

  private createUpdatedStep(
    oldStep: ParameterizedMacroStep,
    newElement: RegisteredElement
  ): ParameterizedMacroStep {
    const actionTemplate = { ...oldStep.actionTemplate };
    if ('targetId' in actionTemplate) {
      actionTemplate.targetId = newElement.id;
    }

    const fallbackSelectors = [
      ...(newElement.locatorStrategy?.selector ? [newElement.locatorStrategy.selector] : []),
      ...(oldStep.fallbackSelectors || []),
    ].filter((v, i, a) => a.indexOf(v) === i);

    return {
      ...oldStep,
      actionTemplate: actionTemplate as import('../actions/Action.js').BrowserAction,
      primaryTargetId: newElement.id,
      primaryTargetRole: newElement.role,
      primaryTargetName: newElement.name,
      fallbackSelectors,
    };
  }

  private persistHealedMacro(
    macro: WorkflowMacro,
    stepIndex: number,
    updatedStep: ParameterizedMacroStep
  ): void {
    if (!this.macroRepo) return;

    const updatedSteps = [...macro.steps];
    updatedSteps[stepIndex] = updatedStep;
    this.macroRepo.recordHealing(macro.id, updatedSteps);
  }
}

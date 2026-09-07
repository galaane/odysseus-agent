import type { PageSnapshot } from '../observer/PageSnapshot.js';
import type { EvaluationResult } from './Evaluator.js';
import type { ActionHistoryEntry } from '../llm/PromptBuilder.js';
import type { Logger } from '../logging/Logger.js';

export type CritiqueCategory =
  | 'network_api_error'
  | 'element_unresponsive'
  | 'modal_obstruction'
  | 'validation_error'
  | 'navigation_stalled'
  | 'general_failure';

export type SuggestedAlternative =
  | 'retry_with_clearance'
  | 'switch_element'
  | 'inspect_network'
  | 'branch_tab'
  | 'replan';

export interface StepCritique {
  step: number;
  category: CritiqueCategory;
  failedActionType: string;
  targetId?: string;
  rootCauseHypothesis: string;
  counterMeasure: string;
  suggestedAlternative: SuggestedAlternative;
  summaryText: string;
}

export interface MicroReflectorInput {
  step: number;
  lastAction?: ActionHistoryEntry;
  expectedOutcome?: string | null;
  previousSnapshot?: PageSnapshot | null;
  currentSnapshot?: PageSnapshot | null;
  evalResult: EvaluationResult;
}

export class MicroReflector {
  constructor(private readonly logger?: Logger) {}

  /**
   * Generates a fast, deterministic, in-flight self-critique when an action fails or yields zero delta.
   */
  public critiqueStep(input: MicroReflectorInput): StepCritique {
    const { step, lastAction, evalResult, previousSnapshot, currentSnapshot, expectedOutcome } = input;
    const actionType = lastAction?.actionType || 'action';
    const targetId = lastAction?.targetId;

    let category: CritiqueCategory = 'general_failure';
    let rootCauseHypothesis = '';
    let counterMeasure = '';
    let suggestedAlternative: SuggestedAlternative = 'replan';

    // 1. Check for Reactive Network / API Errors (from Phase 27)
    const prevFailed = previousSnapshot?.networkSummary?.failedRequests || [];
    const currFailed = currentSnapshot?.networkSummary?.failedRequests || [];
    const newFailed = currFailed.slice(prevFailed.length);

    const prevApiErrors = (previousSnapshot?.networkSummary?.recentApiResponses || []).filter((r) => r.isError);
    const currApiErrors = (currentSnapshot?.networkSummary?.recentApiResponses || []).filter((r) => r.isError);
    const newApiErrors = currApiErrors.slice(prevApiErrors.length);

    if (newFailed.length > 0) {
      const latestFail = newFailed[newFailed.length - 1];
      category = 'network_api_error';
      rootCauseHypothesis = `Network request dropped or aborted: [${latestFail.method}] ${latestFail.url} (${latestFail.errorText}).`;
      counterMeasure = `Do not repeat the identical request immediately. Check network connectivity or verify endpoint URL.`;
      suggestedAlternative = 'inspect_network';
    } else if (newApiErrors.length > 0) {
      const latestError = newApiErrors[newApiErrors.length - 1];
      category = 'network_api_error';
      const bodyHint = latestError.bodySummary ? ` - Payload: "${latestError.bodySummary.slice(0, 150)}"` : '';
      rootCauseHypothesis = `Backend API rejected action with HTTP ${latestError.status} (${latestError.statusText}) on ${latestError.url}${bodyHint}.`;
      counterMeasure = `Backend rejected data. Modify inputs, choose alternative items/options, or inspect required preconditions.`;
      suggestedAlternative = 'inspect_network';
    }
    // 2. Check for Form Validation Errors
    else if (
      evalResult.reason.toLowerCase().includes('invalid') ||
      evalResult.reason.toLowerCase().includes('required') ||
      (currentSnapshot?.compressedObservationText.toLowerCase().includes('required') && actionType === 'click')
    ) {
      category = 'validation_error';
      rootCauseHypothesis = `Form submission or input was rejected due to missing or invalid required fields (${evalResult.reason}).`;
      counterMeasure = `Inspect all required textboxes/comboboxes on the page and fill them with valid values before resubmitting.`;
      suggestedAlternative = 'switch_element';
    }
    // 3. Check for Modal or Overlay Obstruction
    else if (
      evalResult.reason.toLowerCase().includes('modal') ||
      evalResult.reason.toLowerCase().includes('overlay') ||
      evalResult.reason.toLowerCase().includes('cookie') ||
      evalResult.reason.toLowerCase().includes('dialog') ||
      evalResult.reason.toLowerCase().includes('consent') ||
      evalResult.observedChanges.some((c) => {
        const lower = c.toLowerCase();
        return lower.includes('modal') || lower.includes('cookie') || lower.includes('consent') || lower.includes('overlay');
      })
    ) {
      category = 'modal_obstruction';
      rootCauseHypothesis = `Action interaction was blocked or covered by a modal overlay, consent banner, or dialog.`;
      counterMeasure = `Locate the overlay close or accept button and dismiss it before attempting further interactions.`;
      suggestedAlternative = 'retry_with_clearance';
    }
    // 4. Check for Unresponsive Element (Zero State Delta)
    else if (evalResult.observedChanges.length === 0) {
      if (actionType === 'click') {
        category = 'element_unresponsive';
        rootCauseHypothesis = `Click on element [${targetId || 'unknown'}] produced zero observable DOM or URL change. Element may be disabled, an unclickable container, or missing an event handler.`;
        counterMeasure = `Target an adjacent child or parent element (e.g. inner link or submit button) or try pressing Enter in the active input.`;
        suggestedAlternative = 'switch_element';
      } else if (actionType === 'navigate') {
        category = 'navigation_stalled';
        rootCauseHypothesis = `Navigation action did not transition to the expected target page.`;
        counterMeasure = `Verify URL syntax or test opening the link in a speculative background tab.`;
        suggestedAlternative = 'branch_tab';
      } else {
        category = 'element_unresponsive';
        rootCauseHypothesis = `Action "${actionType}" produced no state change.`;
        counterMeasure = `Try an alternative action type or verify element interactive status.`;
        suggestedAlternative = 'replan';
      }
    }
    // 5. General Failure Fallback
    else {
      category = 'general_failure';
      rootCauseHypothesis = `Action failed to achieve expected outcome: ${evalResult.reason || 'No outcome verification'}.`;
      counterMeasure = expectedOutcome
        ? `Re-examine the path toward "${expectedOutcome}" or open a speculative branch tab to test alternatives.`
        : `Replan the remaining milestones.`;
      suggestedAlternative = 'replan';
    }

    const summaryText = `[IN-FLIGHT CRITIQUE (Step ${step})]: Action "${actionType}" on [${targetId || 'page'}] failed (${category}). Cause: ${rootCauseHypothesis} Counter-measure: ${counterMeasure} (Strategy: ${suggestedAlternative})`;

    this.logger?.info('MicroReflector', `Step ${step} critique generated: ${category}`, {
      failedActionType: actionType,
      targetId,
      suggestedAlternative,
    });

    return {
      step,
      category,
      failedActionType: actionType,
      targetId,
      rootCauseHypothesis,
      counterMeasure,
      suggestedAlternative,
      summaryText,
    };
  }

  /**
   * Formats a StepCritique cleanly for injection into prompt context.
   */
  public formatForPrompt(critique: StepCritique): string {
    return critique.summaryText;
  }
}

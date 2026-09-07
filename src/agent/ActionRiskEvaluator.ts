import type { BrowserAction } from '../actions/Action.js';
import type { ElementRegistry } from '../observer/ElementRegistry.js';
import type { ActionCandidate } from '../llm/schemas.js';

export type RiskLevel = 'safe' | 'caution' | 'high_risk' | 'destructive';

export interface ActionRiskAssessment {
  riskLevel: RiskLevel;
  riskScore: number; // 0.0 (safest) to 1.0 (most dangerous)
  reasons: string[];
  isIrreversible: boolean;
  recommendedMitigation?: string;
}

export interface RankedCandidate {
  candidate: ActionCandidate;
  assessment: ActionRiskAssessment;
  utilityScore: number;
  rank: number;
}

export interface RiskEvaluationContext {
  elementRegistry?: ElementRegistry;
  currentUrl?: string;
  openTabsCount?: number;
  activeBranchesCount?: number;
  riskAversionFactor?: number;
}

const DESTRUCTIVE_REGEX = /\b(delete|destroy|remove|purge|erase|drop|terminate|cancel\s+account|close\s+account|wipe|reset\s+data|format)\b/i;
const FINANCIAL_REGEX = /\b(pay\s+now|purchase|buy\s+now|place\s+order|checkout|confirm\s+payment|authorize\s+payment|transfer\s+funds|submit\s+payment)\b/i;
const HIGH_RISK_REGEX = /\b(submit|save\s+changes|update|apply|commit|confirm|send|post|publish|change\s+password)\b/i;
const SENSITIVE_VALUE_REGEX = /\b(?:\d{4}[ -]?){3}\d{4}\b|cvv|cvc|\b\d{3,4}\b/i;

export class ActionRiskEvaluator {
  /**
   * Assesses the empirical risk of a single browser action.
   */
  public assessActionRisk(action: BrowserAction, context?: RiskEvaluationContext): ActionRiskAssessment {
    const reasons: string[] = [];
    let riskScore = 0.1;
    let riskLevel: RiskLevel = 'safe';
    let isIrreversible = false;

    switch (action.type) {
      case 'screenshot':
      case 'scroll':
      case 'wait':
      case 'extract':
      case 'harvest_network_payload': {
        riskScore = 0.0;
        riskLevel = 'safe';
        isIrreversible = false;
        reasons.push(`Read-only action (${action.type}) carries no side effects or mutations.`);
        break;
      }

      case 'branch_tab': {
        riskScore = 0.05;
        riskLevel = 'safe';
        isIrreversible = false;
        reasons.push('Creates an isolated speculative branch tab for safe side-effect testing.');
        break;
      }

      case 'switch_tab': {
        riskScore = 0.05;
        riskLevel = 'safe';
        isIrreversible = false;
        reasons.push(`Non-destructive tab switch to ${action.tabId}.`);
        break;
      }

      case 'new_tab': {
        riskScore = 0.10;
        riskLevel = 'safe';
        isIrreversible = false;
        reasons.push('Opens a fresh tab without mutating existing sessions.');
        break;
      }

      case 'prune_branch': {
        riskScore = 0.30;
        riskLevel = 'caution';
        isIrreversible = false;
        reasons.push(`Prunes speculative exploration branch (${action.reason || 'no reason specified'}).`);
        break;
      }

      case 'promote_branch': {
        riskScore = 0.25;
        riskLevel = 'caution';
        isIrreversible = false;
        reasons.push('Promotes speculative branch to primary execution alur.');
        break;
      }

      case 'close_tab': {
        if (context?.openTabsCount !== undefined && context.openTabsCount <= 1) {
          riskScore = 0.90;
          riskLevel = 'destructive';
          isIrreversible = true;
          reasons.push('Closing the only open tab would terminate the active browser session.');
        } else {
          riskScore = 0.35;
          riskLevel = 'caution';
          isIrreversible = true;
          reasons.push(`Closes tab ${action.tabId}, discarding uncommitted local tab state.`);
        }
        break;
      }

      case 'navigate': {
        riskScore = 0.25;
        riskLevel = 'caution';
        isIrreversible = false;
        reasons.push(`Navigating to ${action.url} discards current DOM view and unsaved form progress.`);
        break;
      }

      case 'press': {
        if (action.key.toLowerCase() === 'enter') {
          riskScore = 0.35;
          riskLevel = 'caution';
          isIrreversible = false;
          reasons.push('Pressing Enter may trigger implicit form submission.');
        } else {
          riskScore = 0.10;
          riskLevel = 'safe';
          isIrreversible = false;
          reasons.push(`Standard keypress: ${action.key}.`);
        }
        break;
      }

      case 'fill':
      case 'type': {
        const textValue = action.type === 'fill' ? action.value : action.text;
        if (SENSITIVE_VALUE_REGEX.test(textValue)) {
          riskScore = 0.70;
          riskLevel = 'high_risk';
          isIrreversible = false;
          reasons.push('Input text contains potential financial card numbers or sensitive verification data.');
        } else {
          const registered = context?.elementRegistry?.get(action.targetId);
          if (registered && DESTRUCTIVE_REGEX.test(registered.name)) {
            riskScore = 0.65;
            riskLevel = 'high_risk';
            isIrreversible = false;
            reasons.push(`Input target "${registered.name}" corresponds to critical confirmation field.`);
          } else {
            riskScore = 0.15;
            riskLevel = 'safe';
            isIrreversible = false;
            reasons.push(`Text entry on target ${action.targetId}.`);
          }
        }
        break;
      }

      case 'click': {
        const registered = context?.elementRegistry?.get(action.targetId);
        if (registered) {
          const name = registered.name.toLowerCase();

          if (DESTRUCTIVE_REGEX.test(name)) {
            riskScore = 0.95;
            riskLevel = 'destructive';
            isIrreversible = true;
            reasons.push(`Target element "${registered.name}" triggers permanent deletion or account destruction.`);
          } else if (FINANCIAL_REGEX.test(name)) {
            riskScore = 0.90;
            riskLevel = 'destructive';
            isIrreversible = true;
            reasons.push(`Target element "${registered.name}" initiates financial payment or order checkout.`);
          } else if (HIGH_RISK_REGEX.test(name)) {
            riskScore = 0.60;
            riskLevel = 'high_risk';
            isIrreversible = false;
            reasons.push(`Target element "${registered.name}" submits or mutates persistent application state.`);
          } else if (registered.role === 'button') {
            riskScore = 0.30;
            riskLevel = 'caution';
            isIrreversible = false;
            reasons.push(`Button click on "${registered.name || registered.id}".`);
          } else if (registered.role === 'link' || registered.role === 'tab') {
            riskScore = 0.15;
            riskLevel = 'safe';
            isIrreversible = false;
            reasons.push(`Navigation link/tab click on "${registered.name || registered.id}".`);
          } else {
            riskScore = 0.15;
            riskLevel = 'safe';
            isIrreversible = false;
            reasons.push(`Interactive click on ${registered.id} (${registered.role}).`);
          }
        } else {
          riskScore = 0.30;
          riskLevel = 'caution';
          isIrreversible = false;
          reasons.push(`Clicking target ${action.targetId} (element not found in current accessibility registry).`);
        }
        break;
      }

      default: {
        riskScore = 0.20;
        riskLevel = 'caution';
        isIrreversible = false;
        reasons.push(`Default assessment for action ${(action as { type: string }).type}.`);
        break;
      }
    }

    let recommendedMitigation: string | undefined;
    if (riskLevel === 'destructive') {
      recommendedMitigation =
        'Action carries high risk or irreversible consequences. Recommend testing in a speculative branch tab (branch_tab) first or confirming prerequisites.';
    } else if (riskLevel === 'high_risk') {
      recommendedMitigation =
        'Action triggers persistent state mutation. Ensure required fields and inputs are verified before committing.';
    }

    return {
      riskLevel,
      riskScore,
      reasons,
      isIrreversible,
      recommendedMitigation,
    };
  }

  /**
   * Evaluates and ranks a set of candidate actions using composite utility scoring:
   * Utility = confidence * (1.0 - riskScore * riskAversionFactor)
   */
  public evaluateCandidates(
    candidates: ActionCandidate[],
    context?: RiskEvaluationContext
  ): RankedCandidate[] {
    const riskAversion = Math.min(Math.max(context?.riskAversionFactor ?? 0.5, 0.1), 0.9);

    const scored = candidates.map((candidate) => {
      const assessment = this.assessActionRisk(candidate.action, context);

      // If candidate already provided an explicit higher risk score, take the maximum
      const effectiveRiskScore = candidate.riskScore !== undefined
        ? Math.max(assessment.riskScore, candidate.riskScore)
        : assessment.riskScore;

      const confidence = candidate.confidence ?? 0.8;
      const utilityScore = Math.max(0, confidence * (1.0 - effectiveRiskScore * riskAversion));

      return {
        candidate,
        assessment: {
          ...assessment,
          riskScore: effectiveRiskScore,
        },
        utilityScore,
        rank: 1, // updated after sorting
      };
    });

    // Sort descending by utilityScore
    scored.sort((a, b) => b.utilityScore - a.utilityScore);

    // Assign final ranks
    scored.forEach((item, index) => {
      item.rank = index + 1;
    });

    return scored;
  }

  /**
   * Selects the highest-utility candidate from the provided list.
   */
  public selectBestCandidate(
    candidates: ActionCandidate[],
    context?: RiskEvaluationContext
  ): RankedCandidate | undefined {
    if (!candidates || candidates.length === 0) {
      return undefined;
    }
    const ranked = this.evaluateCandidates(candidates, context);
    return ranked[0];
  }
}

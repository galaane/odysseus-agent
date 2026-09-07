import type { PageSnapshot } from '../observer/PageSnapshot.js';
import type { LLMProvider } from '../llm/LLM.js';

export interface EvaluationResult {
  status: 'success' | 'partial' | 'failure' | 'unknown';
  observedChanges: string[];
  reason: string;
}

export class Evaluator {
  /**
   * Compares the pre-action and post-action page snapshots against the expected outcome
   * to determine whether the action empirically succeeded, partially succeeded, or failed.
   * (Adheres strictly to Invariant 10: Empirical Verification).
   */
  public evaluate(
    previousSnapshot: PageSnapshot,
    currentSnapshot: PageSnapshot,
    expectedOutcome?: string
  ): EvaluationResult {
    const observedChanges: string[] = [];

    // 1. Check URL navigation
    const urlChanged = previousSnapshot.url !== currentSnapshot.url;
    if (urlChanged) {
      observedChanges.push(`URL navigated from "${previousSnapshot.url}" to "${currentSnapshot.url}"`);
    }

    // 2. Check title changes
    const titleChanged = previousSnapshot.title !== currentSnapshot.title;
    if (titleChanged) {
      observedChanges.push(`Page title changed to "${currentSnapshot.title}"`);
    }

    // 3. Check active tab changes
    const tabChanged = previousSnapshot.activeTabId !== currentSnapshot.activeTabId;
    if (tabChanged) {
      observedChanges.push(`Active tab switched to ${currentSnapshot.activeTabId}`);
    }

    // 4. Check for notices / alerts (success vs error banners)
    const prevNotices = new Set(previousSnapshot.pageSummary.notices || []);
    const currentNotices = currentSnapshot.pageSummary.notices || [];
    const newNotices = currentNotices.filter((n) => !prevNotices.has(n));

    let detectedErrorNotice: string | undefined;
    for (const notice of newNotices) {
      observedChanges.push(`Notice appeared: "${notice}"`);
      const lower = notice.toLowerCase();
      if (
        lower.includes('error') ||
        lower.includes('invalid') ||
        lower.includes('failed') ||
        lower.includes('incorrect') ||
        lower.includes('denied') ||
        lower.includes('unauthorized')
      ) {
        detectedErrorNotice = notice;
      }
    }

    // 5. Compare element counts / text changes
    const prevElementCount = previousSnapshot.interactiveElements.length;
    const currElementCount = currentSnapshot.interactiveElements.length;
    if (Math.abs(currElementCount - prevElementCount) >= 1) {
      observedChanges.push(`Interactive elements count changed (${prevElementCount} -> ${currElementCount})`);
    }

    // 6. Check for value changes in form inputs
    const prevValues = new Map(previousSnapshot.interactiveElements.map((el) => [el.id, el.value]));
    let valueChangedCount = 0;
    for (const el of currentSnapshot.interactiveElements) {
      const oldVal = prevValues.get(el.id);
      if (oldVal !== undefined && el.value !== undefined && oldVal !== el.value) {
        valueChangedCount++;
      }
    }
    if (valueChangedCount > 0) {
      observedChanges.push(`${valueChangedCount} form input value(s) updated`);
    }

    // 7. Check for network dropouts and API errors (Phase 27)
    let detectedNetworkError: string | undefined;
    if (currentSnapshot.networkSummary) {
      const prevFailed = previousSnapshot.networkSummary?.failedRequests || [];
      const currFailed = currentSnapshot.networkSummary.failedRequests || [];
      const newFailed = currFailed.slice(prevFailed.length);
      if (newFailed.length > 0) {
        const latest = newFailed[newFailed.length - 1];
        detectedNetworkError = `Network request failed: [${latest.method}] ${latest.url} (${latest.errorText})`;
        observedChanges.push(detectedNetworkError);
      } else {
        const prevApiErrors = (previousSnapshot.networkSummary?.recentApiResponses || []).filter((r) => r.isError);
        const currApiErrors = (currentSnapshot.networkSummary.recentApiResponses || []).filter((r) => r.isError);
        const newApiErrors = currApiErrors.slice(prevApiErrors.length);
        if (newApiErrors.length > 0) {
          const latest = newApiErrors[newApiErrors.length - 1];
          const snippet = latest.bodySummary ? ` - ${latest.bodySummary}` : '';
          detectedNetworkError = `Backend API error [HTTP ${latest.status}]: [${latest.method}] ${latest.url}${snippet}`;
          observedChanges.push(detectedNetworkError);
        }
      }
    }

    // 8. Evaluate outcome against expectedOutcome
    const expectedLower = (expectedOutcome || '').toLowerCase().trim();

    // If an error notice appeared and the expected outcome was NOT expecting an error:
    if (detectedErrorNotice && !expectedLower.includes('error') && !expectedLower.includes('invalid')) {
      return {
        status: 'failure',
        observedChanges,
        reason: `Error banner detected: "${detectedErrorNotice}"`,
      };
    }

    // If a network dropout or API error response appeared and expected outcome was NOT expecting failure:
    if (detectedNetworkError && !expectedLower.includes('error') && !expectedLower.includes('fail')) {
      return {
        status: 'failure',
        observedChanges,
        reason: detectedNetworkError,
      };
    }

    // If expected outcome specified and matches
    if (expectedLower) {
      const currentObsText = currentSnapshot.compressedObservationText.toLowerCase();

      // Check if URL or path mentioned in expected outcome matches current URL
      if (urlChanged && (expectedLower.includes('navigat') || expectedLower.includes('redirect') || expectedLower.includes('url'))) {
        return {
          status: 'success',
          observedChanges,
          reason: `Navigation occurred as expected to ${currentSnapshot.url}.`,
        };
      }

      // Check if keywords from expectedOutcome now appear in observation text
      const keywords = expectedLower
        .split(/\s+/)
        .filter((w) => w.length > 3 && !['page', 'should', 'with', 'from', 'that', 'this'].includes(w));

      const matchedKeywords = keywords.filter((k) => currentObsText.includes(k));
      if (matchedKeywords.length >= Math.ceil(keywords.length * 0.5) && matchedKeywords.length > 0) {
        return {
          status: 'success',
          observedChanges,
          reason: `Expected outcome verified: matched keywords [${matchedKeywords.join(', ')}].`,
        };
      }
    }

    // Default heuristics based on observed state changes
    if (observedChanges.length > 0) {
      return {
        status: 'success',
        observedChanges,
        reason: `State changed successfully: ${observedChanges[0]}`,
      };
    }

    // If no state changes were observed at all
    return {
      status: expectedLower ? 'failure' : 'unknown',
      observedChanges: [],
      reason: expectedLower
        ? `No state change observed on page; expected "${expectedOutcome}".`
        : 'No state changes detected.',
    };
  }

  /**
   * Evaluates the current page state against the expected outcome using the LLM (fast-tier).
   * Used for Doubt-Driven Self-Correction to verify critical milestones.
   */
  public async evaluateCritically(
    expectedOutcome: string,
    currentSnapshot: PageSnapshot,
    llmProvider: LLMProvider
  ): Promise<EvaluationResult> {
    if (!expectedOutcome || !llmProvider) {
      return { status: 'unknown', observedChanges: [], reason: 'No outcome or provider' };
    }

    try {
      const response = await llmProvider.generateDecision({
        messages: [
          {
            role: 'system',
            content: `You are an evaluator. Based on the expected outcome and the current page snapshot, determine if the expected outcome was successfully achieved. 
Respond in strict JSON format:
{
  "status": "continue",
  "reasoning_summary": "<Explain if success, partial, or failure>",
  "expectedOutcome": "<success | partial | failure>"
}`
          },
          {
            role: 'user',
            content: `Expected Outcome: ${expectedOutcome}\n\nCurrent Snapshot:\n${currentSnapshot.compressedObservationText}`
          }
        ],
        temperature: 0.1,
        maxTokens: 150,
        reasoningTier: 'fast'
      });

      const outcomeLower = (response.expectedOutcome || '').toLowerCase();
      let status: 'success' | 'partial' | 'failure' | 'unknown' = 'unknown';

      if (outcomeLower.includes('success')) status = 'success';
      else if (outcomeLower.includes('partial')) status = 'partial';
      else if (outcomeLower.includes('fail')) status = 'failure';

      return {
        status,
        observedChanges: ['Evaluated via doubt-driven LLM check'],
        reason: response.reasoning_summary || 'No reasoning provided',
      };
    } catch (e) {
      return { status: 'unknown', observedChanges: [], reason: 'LLM evaluation failed' };
    }
  }
}

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MicroReflector } from '../../src/agent/MicroReflector.js';
import type { PageSnapshot } from '../../src/observer/PageSnapshot.js';
import type { EvaluationResult } from '../../src/agent/Evaluator.js';
import { Logger } from '../../src/logging/Logger.js';

function makeSnapshot(options?: {
  url?: string;
  compressedText?: string;
  networkSummary?: PageSnapshot['networkSummary'];
}): PageSnapshot {
  return {
    timestamp: new Date().toISOString(),
    url: options?.url ?? 'https://store.local/checkout',
    title: 'Checkout Store',
    activeTabId: 'tab_001',
    interactiveElements: [],
    pageSummary: {
      headings: ['Checkout'],
      forms: [],
      links: [],
      notices: [],
    },
    compressedObservationText: options?.compressedText ?? '[Page: "Checkout Store"]',
    networkSummary: options?.networkSummary,
  };
}

describe('Phase 28: In-Flight Micro-Reflexion Subsystem', () => {
  let logger: Logger;
  let microReflector: MicroReflector;

  beforeEach(() => {
    logger = new Logger('debug', () => {});
    microReflector = new MicroReflector(logger);
  });

  describe('MicroReflector.critiqueStep', () => {
    it('should diagnose backend API rejection with HTTP 4xx/5xx', () => {
      const prevSnap = makeSnapshot({
        networkSummary: { failedRequests: [], recentApiResponses: [] },
      });

      const currSnap = makeSnapshot({
        networkSummary: {
          failedRequests: [],
          recentApiResponses: [
            {
              url: 'https://store.local/api/cart/checkout',
              method: 'POST',
              status: 422,
              statusText: 'Unprocessable Entity',
              isError: true,
              bodySummary: '{"error": "Item out of stock"}',
              timestamp: '2026-09-07T00:00:01Z',
            },
          ],
        },
      });

      const evalResult: EvaluationResult = {
        status: 'failure',
        observedChanges: ['Backend API error [HTTP 422]: [POST] https://store.local/api/cart/checkout - {"error": "Item out of stock"}'],
        reason: 'Backend API error [HTTP 422]: [POST] https://store.local/api/cart/checkout - {"error": "Item out of stock"}',
      };

      const critique = microReflector.critiqueStep({
        step: 3,
        lastAction: { step: 3, actionType: 'click', targetId: 'e15' },
        expectedOutcome: 'Order placed',
        previousSnapshot: prevSnap,
        currentSnapshot: currSnap,
        evalResult,
      });

      expect(critique.step).toBe(3);
      expect(critique.category).toBe('network_api_error');
      expect(critique.failedActionType).toBe('click');
      expect(critique.targetId).toBe('e15');
      expect(critique.suggestedAlternative).toBe('inspect_network');
      expect(critique.rootCauseHypothesis).toContain('HTTP 422');
      expect(critique.rootCauseHypothesis).toContain('Item out of stock');
      expect(critique.summaryText).toContain('[IN-FLIGHT CRITIQUE (Step 3)]');
    });

    it('should diagnose dropped network requests', () => {
      const prevSnap = makeSnapshot({
        networkSummary: { failedRequests: [], recentApiResponses: [] },
      });

      const currSnap = makeSnapshot({
        networkSummary: {
          failedRequests: [
            {
              url: 'https://store.local/api/save',
              method: 'POST',
              resourceType: 'fetch',
              errorText: 'net::ERR_CONNECTION_RESET',
              timestamp: '2026-09-07T00:00:02Z',
            },
          ],
          recentApiResponses: [],
        },
      });

      const evalResult: EvaluationResult = {
        status: 'failure',
        observedChanges: ['Network request failed: [POST] https://store.local/api/save (net::ERR_CONNECTION_RESET)'],
        reason: 'Network request failed: [POST] https://store.local/api/save (net::ERR_CONNECTION_RESET)',
      };

      const critique = microReflector.critiqueStep({
        step: 2,
        lastAction: { step: 2, actionType: 'click', targetId: 'e20' },
        expectedOutcome: 'Changes saved',
        previousSnapshot: prevSnap,
        currentSnapshot: currSnap,
        evalResult,
      });

      expect(critique.category).toBe('network_api_error');
      expect(critique.suggestedAlternative).toBe('inspect_network');
      expect(critique.rootCauseHypothesis).toContain('net::ERR_CONNECTION_RESET');
    });

    it('should diagnose modal or overlay obstruction', () => {
      const prevSnap = makeSnapshot();
      const currSnap = makeSnapshot();

      const evalResult: EvaluationResult = {
        status: 'failure',
        observedChanges: ['Notice appeared: "Cookie consent modal"'],
        reason: 'Error banner detected: "Cookie consent modal"',
      };

      const critique = microReflector.critiqueStep({
        step: 1,
        lastAction: { step: 1, actionType: 'click', targetId: 'e5' },
        expectedOutcome: 'Navigated to catalog',
        previousSnapshot: prevSnap,
        currentSnapshot: currSnap,
        evalResult,
      });

      expect(critique.category).toBe('modal_obstruction');
      expect(critique.suggestedAlternative).toBe('retry_with_clearance');
      expect(critique.counterMeasure).toContain('Locate the overlay close or accept button');
    });

    it('should diagnose form validation errors', () => {
      const prevSnap = makeSnapshot();
      const currSnap = makeSnapshot({
        compressedText: '[Page: "Register"] - Notice: "Email is a required field"',
      });

      const evalResult: EvaluationResult = {
        status: 'failure',
        observedChanges: ['Notice appeared: "Email is a required field"'],
        reason: 'Error banner detected: "Email is a required field"',
      };

      const critique = microReflector.critiqueStep({
        step: 4,
        lastAction: { step: 4, actionType: 'click', targetId: 'e_submit' },
        expectedOutcome: 'Registration complete',
        previousSnapshot: prevSnap,
        currentSnapshot: currSnap,
        evalResult,
      });

      expect(critique.category).toBe('validation_error');
      expect(critique.suggestedAlternative).toBe('switch_element');
      expect(critique.counterMeasure).toContain('fill them with valid values');
    });

    it('should diagnose unresponsive element when zero state changes occur on click', () => {
      const prevSnap = makeSnapshot();
      const currSnap = makeSnapshot();

      const evalResult: EvaluationResult = {
        status: 'failure',
        observedChanges: [],
        reason: 'No state change observed on page; expected "Search results updated".',
      };

      const critique = microReflector.critiqueStep({
        step: 5,
        lastAction: { step: 5, actionType: 'click', targetId: 'e_search_btn' },
        expectedOutcome: 'Search results updated',
        previousSnapshot: prevSnap,
        currentSnapshot: currSnap,
        evalResult,
      });

      expect(critique.category).toBe('element_unresponsive');
      expect(critique.suggestedAlternative).toBe('switch_element');
      expect(critique.rootCauseHypothesis).toContain('Click on element [e_search_btn] produced zero observable DOM or URL change');
    });

    it('should diagnose stalled navigation when zero state changes occur on navigate', () => {
      const prevSnap = makeSnapshot();
      const currSnap = makeSnapshot();

      const evalResult: EvaluationResult = {
        status: 'failure',
        observedChanges: [],
        reason: 'No state change observed on page; expected "Navigated to external dashboard".',
      };

      const critique = microReflector.critiqueStep({
        step: 6,
        lastAction: { step: 6, actionType: 'navigate' },
        expectedOutcome: 'Navigated to external dashboard',
        previousSnapshot: prevSnap,
        currentSnapshot: currSnap,
        evalResult,
      });

      expect(critique.category).toBe('navigation_stalled');
      expect(critique.suggestedAlternative).toBe('branch_tab');
      expect(critique.counterMeasure).toContain('speculative background tab');
    });

    it('should format critique properly for prompt inclusion', () => {
      const critique = microReflector.critiqueStep({
        step: 2,
        lastAction: { step: 2, actionType: 'click', targetId: 'e3' },
        expectedOutcome: 'Next page',
        evalResult: { status: 'failure', observedChanges: [], reason: 'Target not reached' },
      });

      const formatted = microReflector.formatForPrompt(critique);
      expect(formatted).toBe(critique.summaryText);
      expect(formatted).toContain('[IN-FLIGHT CRITIQUE (Step 2)]');
    });
  });
});

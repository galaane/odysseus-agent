import { describe, it, expect } from 'vitest';
import { MetricsReporter } from '../../src/logging/MetricsReporter.js';

describe('Phase 14: Quality & Performance Metrics Subsystem', () => {
  it('should initialize with default zero metrics', () => {
    const reporter = new MetricsReporter();
    const metrics = reporter.getMetrics();

    expect(metrics.tasks.total).toBe(0);
    expect(metrics.tasks.successRate).toBe(1.0);
    expect(metrics.actions.total).toBe(0);
    expect(metrics.actions.successRate).toBe(1.0);
    expect(metrics.recovery.totalAttempts).toBe(0);
    expect(metrics.recovery.recoveryRate).toBe(1.0);
    expect(metrics.tokens.totalTokens).toBe(0);
  });

  it('should record task executions and calculate rates and averages', () => {
    const reporter = new MetricsReporter();

    reporter.recordTask({ success: true, steps: 10, durationMs: 5000 });
    reporter.recordTask({ success: true, steps: 20, durationMs: 7000 });
    reporter.recordTask({ success: false, steps: 15, durationMs: 6000 });

    const m = reporter.getMetrics();

    expect(m.tasks.total).toBe(3);
    expect(m.tasks.successful).toBe(2);
    expect(m.tasks.failed).toBe(1);
    expect(m.tasks.successRate).toBeCloseTo(2 / 3);
    expect(m.tasks.averageSteps).toBe(15);
    expect(m.tasks.averageDurationMs).toBe(6000);
  });

  it('should record actions and maintain breakdown by action type', () => {
    const reporter = new MetricsReporter();

    reporter.recordAction('click', true);
    reporter.recordAction('click', true);
    reporter.recordAction('click', false);
    reporter.recordAction('type', true);
    reporter.recordAction('navigate', true);

    const m = reporter.getMetrics();

    expect(m.actions.total).toBe(5);
    expect(m.actions.successful).toBe(4);
    expect(m.actions.failed).toBe(1);
    expect(m.actions.successRate).toBe(0.8);

    expect(m.actions.byType['click'].total).toBe(3);
    expect(m.actions.byType['click'].successful).toBe(2);
    expect(m.actions.byType['click'].failed).toBe(1);

    expect(m.actions.byType['type'].total).toBe(1);
    expect(m.actions.byType['navigate'].total).toBe(1);
  });

  it('should record systematic recovery attempts and track recovery rate and tier breakdown', () => {
    const reporter = new MetricsReporter();

    reporter.recordRecovery(true, 1);
    reporter.recordRecovery(true, 2);
    reporter.recordRecovery(true, 2);
    reporter.recordRecovery(false);

    const m = reporter.getMetrics();

    expect(m.recovery.totalAttempts).toBe(4);
    expect(m.recovery.successfulRecoveries).toBe(3);
    expect(m.recovery.failedRecoveries).toBe(1);
    expect(m.recovery.recoveryRate).toBe(0.75);

    expect(m.recovery.byTier[1]).toBe(1);
    expect(m.recovery.byTier[2]).toBe(2);
  });

  it('should accumulate LLM token usage', () => {
    const reporter = new MetricsReporter();

    reporter.recordTokens({ promptTokens: 1200, completionTokens: 350 });
    reporter.recordTokens({ promptTokens: 800, completionTokens: 150 });

    const m = reporter.getMetrics();

    expect(m.tokens.promptTokens).toBe(2000);
    expect(m.tokens.completionTokens).toBe(500);
    expect(m.tokens.totalTokens).toBe(2500);
  });

  it('should generate formatted markdown summary', () => {
    const reporter = new MetricsReporter();
    reporter.recordTask({ success: true, steps: 5, durationMs: 2000 });
    reporter.recordAction('click', true);
    reporter.recordRecovery(true, 1);
    reporter.recordTokens({ promptTokens: 500, completionTokens: 100 });

    const summary = reporter.generateSummary();

    expect(summary).toContain('# Odysseus Autonomous Agent — Quality & Performance Metrics');
    expect(summary).toContain('Total Tasks: 1');
    expect(summary).toContain('Task Success Rate: 100.0%');
    expect(summary).toContain('Total Browser Actions: 1');
    expect(summary).toContain('Prompt Tokens: 500');
  });

  it('should reset all recorded counters cleanly', () => {
    const reporter = new MetricsReporter();
    reporter.recordTask({ success: true, steps: 5 });
    reporter.recordAction('click', true);
    reporter.recordRecovery(true, 1);
    reporter.recordTokens({ promptTokens: 100, completionTokens: 50 });

    reporter.reset();

    const m = reporter.getMetrics();
    expect(m.tasks.total).toBe(0);
    expect(m.actions.total).toBe(0);
    expect(m.recovery.totalAttempts).toBe(0);
    expect(m.tokens.totalTokens).toBe(0);
  });
});

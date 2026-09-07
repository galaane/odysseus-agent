import { describe, it, expect, beforeEach } from 'vitest';
import { FrustrationMonitor } from '../../src/agent/FrustrationMonitor.js';

describe('FrustrationMonitor', () => {
  let monitor: FrustrationMonitor;

  beforeEach(() => {
    monitor = new FrustrationMonitor();
  });

  it('should start with low frustration', () => {
    expect(monitor.getFrustrationLevel().level).toBe('low');
    expect(monitor.isCritical()).toBe(false);
  });

  it('should escalate frustration level on repeated target failures', () => {
    monitor.recordFailure('btn_1');
    expect(monitor.getFrustrationLevel().level).toBe('medium');

    monitor.recordFailure('btn_1');
    expect(monitor.getFrustrationLevel().level).toBe('high');

    monitor.recordFailure('btn_1');
    const result = monitor.getFrustrationLevel();
    expect(result.level).toBe('critical');
    expect(result.reason).toContain('target btn_1 3 times');
    expect(monitor.isCritical()).toBe(true);
  });

  it('should reset frustration on success', () => {
    monitor.recordFailure('btn_1');
    monitor.recordFailure('btn_1');
    expect(monitor.getFrustrationLevel().level).toBe('high');

    monitor.recordSuccess();
    expect(monitor.getFrustrationLevel().level).toBe('low');
    expect(monitor.isCritical()).toBe(false);
  });

  it('should escalate on general consecutive failures', () => {
    for (let i = 0; i < 4; i++) {
      monitor.recordFailure();
    }
    expect(monitor.getFrustrationLevel().level).toBe('high');

    monitor.recordFailure(); // 5th failure
    const result = monitor.getFrustrationLevel();
    expect(result.level).toBe('critical');
    expect(result.reason).toContain('5 consecutive steps');
    expect(monitor.isCritical()).toBe(true);
  });
});

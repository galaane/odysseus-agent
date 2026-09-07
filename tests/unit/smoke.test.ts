import { describe, it, expect } from 'vitest';
import { PROJECT_NAME, PROJECT_VERSION } from '../../src/index.js';

describe('Phase 0 Smoke Test Harness', () => {
  it('should verify project metadata exports', () => {
    expect(PROJECT_NAME).toBe('odysseus-autonomous-browser-agent');
    expect(PROJECT_VERSION).toBe('1.0.0');
  });

  it('should verify Node.js runtime meets v20+ requirement', () => {
    const majorVersion = parseInt(process.versions.node.split('.')[0], 10);
    expect(majorVersion).toBeGreaterThanOrEqual(20);
  });
});

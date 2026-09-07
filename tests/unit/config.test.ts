import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { loadConfig, ConfigError } from '../../src/config/Config.js';

describe('Config Subsystem', () => {
  it('should load default configuration when no environment variables are set', () => {
    const config = loadConfig({});
    expect(config.nodeEnv).toBe('development');
    expect(config.logLevel).toBe('info');
    expect(config.llmProvider).toBe('openai');
    expect(config.llmModel).toBe('gpt-4o');
    expect(config.browserHeadless).toBe(false);
    expect(config.maxAgentSteps).toBe(100);
    expect(config.maxTaskDurationMs).toBe(600000);
    expect(config.actionTimeoutMs).toBe(30000);
    expect(config.port).toBe(3000);
    expect(config.testSitePort).toBe(3099);

    // Verify paths are normalized to absolute paths
    expect(path.isAbsolute(config.browserProfilePath)).toBe(true);
    expect(path.isAbsolute(config.databasePath)).toBe(true);
    expect(path.isAbsolute(config.downloadDir)).toBe(true);
    expect(path.isAbsolute(config.screenshotDir)).toBe(true);
    expect(path.isAbsolute(config.workspaceDir)).toBe(true);
  });

  it('should parse and apply valid environment overrides', () => {
    const overrides = {
      NODE_ENV: 'production',
      LOG_LEVEL: 'debug',
      LLM_PROVIDER: 'custom',
      LLM_MODEL: 'claude-3-5-sonnet',
      LLM_API_KEY: 'test-key-123',
      LLM_BASE_URL: 'https://api.custom-llm.com/v1',
      BROWSER_HEADLESS: 'true',
      MAX_AGENT_STEPS: '50',
      MAX_TASK_DURATION_MS: '300000',
      ACTION_TIMEOUT_MS: '15000',
      PORT: '8080',
      TEST_SITE_PORT: '9090',
    };

    const config = loadConfig(overrides);
    expect(config.nodeEnv).toBe('production');
    expect(config.logLevel).toBe('debug');
    expect(config.llmProvider).toBe('custom');
    expect(config.llmModel).toBe('claude-3-5-sonnet');
    expect(config.llmApiKey).toBe('test-key-123');
    expect(config.llmBaseUrl).toBe('https://api.custom-llm.com/v1');
    expect(config.browserHeadless).toBe(true);
    expect(config.maxAgentSteps).toBe(50);
    expect(config.maxTaskDurationMs).toBe(300000);
    expect(config.actionTimeoutMs).toBe(15000);
    expect(config.port).toBe(8080);
    expect(config.testSitePort).toBe(9090);
  });

  it('should throw ConfigError on invalid enum values', () => {
    expect(() => {
      loadConfig({ NODE_ENV: 'invalid_environment' });
    }).toThrow(ConfigError);
  });

  it('should throw ConfigError on invalid numerical values', () => {
    expect(() => {
      loadConfig({ MAX_AGENT_STEPS: '-5' });
    }).toThrow(ConfigError);

    expect(() => {
      loadConfig({ ACTION_TIMEOUT_MS: 'not_a_number' });
    }).toThrow(ConfigError);
  });

  it('should throw ConfigError on invalid URL for LLM_BASE_URL', () => {
    expect(() => {
      loadConfig({ LLM_BASE_URL: 'invalid-url' });
    }).toThrow(ConfigError);
  });
});

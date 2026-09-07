import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

// Load .env if present
dotenv.config();

export class ConfigError extends Error {
  constructor(message: string, public readonly issues?: z.ZodIssue[]) {
    super(message);
    this.name = 'ConfigError';
  }
}

export const ConfigSchema = z.object({
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // LLM Configuration
  llmProvider: z.enum(['openai', 'mock', 'custom']).default('openai'),
  llmModel: z.string().default('gpt-4o'),
  llmFastModel: z.string().default('gpt-4o-mini'),
  llmDeepModel: z.string().default('gpt-4o'),
  llmRoutingEnabled: z.boolean().default(false),
  llmApiKey: z.string().optional(),
  llmBaseUrl: z.string().url().optional(),

  // Browser Runtime Configuration
  browserProfilePath: z.string().default('./data/browser-profile'),
  browserHeadless: z.boolean().default(false),

  // Execution Limits & Timeouts
  maxAgentSteps: z.number().int().positive().default(100),
  maxTaskDurationMs: z.number().int().positive().default(600000), // 10 minutes
  actionTimeoutMs: z.number().int().positive().default(30000), // 30 seconds

  // Storage & Persistence
  databasePath: z.string().default('./data/agent.db'),
  downloadDir: z.string().default('./data/downloads'),
  screenshotDir: z.string().default('./data/screenshots'),
  workspaceDir: z.string().default('./data/workspace'),

  // Network & Ports
  port: z.number().int().positive().default(3000),
  testSitePort: z.number().int().positive().default(3099),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Parses raw environment variables into a typed, validated Config object.
 */
export function loadConfig(rawEnv: Record<string, string | undefined> = process.env): Config {
  const parsedHeadless = rawEnv.BROWSER_HEADLESS !== undefined
    ? rawEnv.BROWSER_HEADLESS.toLowerCase() === 'true' || rawEnv.BROWSER_HEADLESS === '1'
    : undefined;

  const parseNumber = (val: string | undefined): number | undefined => {
    if (val === undefined || val.trim() === '') return undefined;
    return Number(val);
  };

  const rawConfig = {
    nodeEnv: rawEnv.NODE_ENV,
    logLevel: rawEnv.LOG_LEVEL,
    llmProvider: rawEnv.LLM_PROVIDER,
    llmModel: rawEnv.LLM_MODEL,
    llmFastModel: rawEnv.LLM_FAST_MODEL,
    llmDeepModel: rawEnv.LLM_DEEP_MODEL || rawEnv.LLM_MODEL,
    llmRoutingEnabled: rawEnv.LLM_ROUTING_ENABLED !== undefined
      ? rawEnv.LLM_ROUTING_ENABLED.toLowerCase() === 'true' || rawEnv.LLM_ROUTING_ENABLED === '1'
      : undefined,
    llmApiKey: rawEnv.LLM_API_KEY || undefined,
    llmBaseUrl: rawEnv.LLM_BASE_URL || undefined,
    browserProfilePath: rawEnv.BROWSER_PROFILE_PATH,
    browserHeadless: parsedHeadless,
    maxAgentSteps: parseNumber(rawEnv.MAX_AGENT_STEPS),
    maxTaskDurationMs: parseNumber(rawEnv.MAX_TASK_DURATION_MS),
    actionTimeoutMs: parseNumber(rawEnv.ACTION_TIMEOUT_MS),
    databasePath: rawEnv.DATABASE_PATH,
    downloadDir: rawEnv.DOWNLOAD_DIR,
    screenshotDir: rawEnv.SCREENSHOT_DIR,
    workspaceDir: rawEnv.WORKSPACE_DIR,
    port: parseNumber(rawEnv.PORT),
    testSitePort: parseNumber(rawEnv.TEST_SITE_PORT),
  };

  // Filter out undefined keys so defaults apply properly
  const cleanedConfig = Object.fromEntries(
    Object.entries(rawConfig).filter(([, v]) => v !== undefined)
  );

  const result = ConfigSchema.safeParse(cleanedConfig);

  if (!result.success) {
    const errorDetails = result.error.issues
      .map((issue) => `[${issue.path.join('.')}] ${issue.message}`)
      .join(', ');
    throw new ConfigError(`Invalid configuration: ${errorDetails}`, result.error.issues);
  }

  const baseDir = process.cwd();
  const config = result.data;

  // Normalize all filesystem paths to absolute paths
  return {
    ...config,
    browserProfilePath: path.resolve(baseDir, config.browserProfilePath),
    databasePath: path.resolve(baseDir, config.databasePath),
    downloadDir: path.resolve(baseDir, config.downloadDir),
    screenshotDir: path.resolve(baseDir, config.screenshotDir),
    workspaceDir: path.resolve(baseDir, config.workspaceDir),
  };
}

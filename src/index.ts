/**
 * Odysseus Autonomous Browser Agent
 * Main Library Exports
 */

export const PROJECT_NAME = 'odysseus-autonomous-browser-agent';
export const PROJECT_VERSION = '1.0.0';

// Config
export * from './config/Config.js';

// Errors
export * from './browser/BrowserError.js';
export * from './agent/AgentError.js';

// Logging
export * from './logging/Logger.js';
export * from './logging/EventLogger.js';
export * from './logging/Trace.js';
export * from './logging/MetricsReporter.js';

// Browser Infrastructure
export * from './browser/ActionMutex.js';
export * from './browser/BrowserManager.js';
export * from './browser/BrowserEvents.js';
export * from './browser/BrowserState.js';
export * from './browser/TabManager.js';
export * from './browser/PageManager.js';
export * from './browser/BrowserWatchdog.js';

// Typed Actions Engine
export * from './actions/Action.js';
export * from './actions/ActionResult.js';
export * from './actions/ActionValidator.js';
export * from './actions/ActionExecutionContext.js';
export * from './actions/ActionRegistry.js';

// Perception & Observation
export * from './observer/index.js';

// LLM & Prompts
export * from './llm/index.js';

// Agent Runtime & Recovery
export * from './agent/index.js';

// Persistence & SQLite Database
export * from './persistence/index.js';

// Memory Subsystem
export * from './memory/index.js';

// Credentials & Isolated Vault
export * from './credentials/index.js';

// Research Subsystem
export * from './research/index.js';
export type { Source } from './research/index.js';
export type { Finding } from './research/index.js';

// Task API & Web Dashboard
export * from './api/index.js';

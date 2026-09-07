import { loadConfig } from '../src/config/Config.js';
import { Logger } from '../src/logging/Logger.js';
import { BrowserManager } from '../src/browser/BrowserManager.js';
import { ActionRegistry } from '../src/actions/ActionRegistry.js';
import { PageObserver } from '../src/observer/PageObserver.js';
import { OpenAIProvider } from '../src/llm/OpenAIProvider.js';
import { SqliteDatabase } from '../src/persistence/Database.js';
import { OdysseusAgent } from '../src/agent/Agent.js';

async function main() {
  const goal = process.argv.slice(2).join(' ') || 'Navigate to https://example.com and summarize the main content';
  const config = loadConfig();
  const logger = new Logger(config.logLevel);

  logger.info('CLI', `Running task with goal: "${goal}"`);
  logger.info('CLI', `Using LLM Base URL: ${config.llmBaseUrl || 'https://api.openai.com/v1'} (Model: ${config.llmModel})`);

  const browserManager = new BrowserManager(config, logger);
  await browserManager.start();

  const actionRegistry = new ActionRegistry();
  const pageObserver = new PageObserver();
  const llmProvider = new OpenAIProvider({
    apiKey: config.llmApiKey,
    model: config.llmModel,
    baseUrl: config.llmBaseUrl,
  });
  const database = new SqliteDatabase({ path: config.databasePath, logger });

  const agent = new OdysseusAgent({
    browserManager,
    actionRegistry,
    pageObserver,
    llmProvider,
    database,
    logger,
    config,
  });

  const taskId = `cli_task_${Date.now()}`;
  try {
    const result = await agent.run({
      id: taskId,
      goal,
      maxSteps: config.maxAgentSteps,
    });

    console.log('\n=========================================');
    console.log(`STATUS: ${result.status.toUpperCase()}`);
    console.log(`STEPS: ${result.steps}`);
    console.log(`DURATION: ${(result.durationMs / 1000).toFixed(1)}s`);
    console.log(`SUMMARY: ${result.summary}`);
    if (result.findings && result.findings.length > 0) {
      console.log('FINDINGS:');
      for (const f of result.findings) {
        console.log(` - ${f.claim} (confidence: ${f.confidence ?? 1.0})`);
      }
    }
    console.log('=========================================\n');
  } catch (err) {
    logger.error('CLI', `Task execution failed: ${String(err)}`);
  } finally {
    await browserManager.stop();
  }
}

main().catch(console.error);

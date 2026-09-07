import { loadConfig } from '../src/config/Config.js';
import { Logger } from '../src/logging/Logger.js';
import { BrowserManager } from '../src/browser/BrowserManager.js';
import { ActionRegistry } from '../src/actions/ActionRegistry.js';
import { PageObserver } from '../src/observer/PageObserver.js';
import { OpenAIProvider } from '../src/llm/OpenAIProvider.js';
import { SqliteDatabase } from '../src/persistence/Database.js';
import { OdysseusAgent } from '../src/agent/Agent.js';
import { TaskServer } from '../src/api/TaskServer.js';

async function main() {
  const config = loadConfig();
  const logger = new Logger(config.logLevel);

  logger.info('Dashboard', 'Initializing Odysseus Browser Agent & Dashboard Server...');

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

  const server = new TaskServer({
    agent,
    logger,
    port: config.port || 3000,
  });

  const activePort = await server.start();
  console.log(`\n=============================================================`);
  console.log(`🚀 Mission Control Dashboard is running!`);
  console.log(`👉 Open your browser at: http://localhost:${activePort}`);
  console.log(`=============================================================\n`);

  process.on('SIGINT', async () => {
    logger.info('Dashboard', 'Shutting down...');
    await server.stop();
    await browserManager.stop();
    process.exit(0);
  });
}

main().catch(console.error);

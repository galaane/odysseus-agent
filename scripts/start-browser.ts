import { loadConfig } from '../src/config/Config.js';
import { Logger } from '../src/logging/Logger.js';
import { BrowserManager } from '../src/browser/BrowserManager.js';

async function main() {
  const config = loadConfig();
  const logger = new Logger(config.logLevel);

  logger.info('StartBrowser', 'Starting persistent CloakBrowser instance...');
  const browserManager = new BrowserManager(config, logger);

  try {
    await browserManager.start();
    const pageManager = browserManager.getPageManager();
    const page = pageManager.getActivePage();

    try {
      await page.goto('https://example.com', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      logger.info('StartBrowser', `Successfully opened page: ${page.url()}`);
    } catch (navErr) {
      logger.warn('StartBrowser', `Navigation to example.com timed out or failed (${String(navErr)}), but browser instance is running and healthy.`);
    }

    logger.info('StartBrowser', 'Browser is running! Press Ctrl+C in terminal to stop.');

    // Keep process alive until user presses Ctrl+C
    await new Promise(() => {});
  } catch (err) {
    logger.error('StartBrowser', `Browser launch error: ${String(err)}`);
    process.exit(1);
  } finally {
    await browserManager.stop();
  }
}

main().catch(console.error);

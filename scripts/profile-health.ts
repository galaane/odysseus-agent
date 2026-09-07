import { loadConfig } from '../src/config/Config.js';
import { Logger } from '../src/logging/Logger.js';
import { ProfileHealthMonitor } from '../src/stealth/ProfileHealthMonitor.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const shouldClean = args.includes('--clean');
  const dryRun = args.includes('--dry-run');

  const config = loadConfig();
  const logger = new Logger('info');
  const monitor = new ProfileHealthMonitor(config.browserProfilePath, logger);

  console.log(`\n🔍 Inspecting Persistent Profile Health at: [${config.browserProfilePath}]`);
  const report = await monitor.inspectProfile();

  const totalDiskMb = (report.diskUsageBytes / (1024 * 1024)).toFixed(2);
  const cacheMb = (report.cacheUsageBytes / (1024 * 1024)).toFixed(2);

  console.log(`\n================ Profile Storage Health Report ================`);
  console.log(`Status:               ${report.status.toUpperCase()}`);
  console.log(`Total Disk Footprint: ${totalDiskMb} MB`);
  console.log(`Ephemeral Cache:      ${cacheMb} MB`);
  console.log(`Orphaned Dump Files:  ${report.orphanedFilesCount}`);
  console.log(`=================================================================\n`);

  if (shouldClean) {
    console.log(`🧹 Initiating safe ephemeral cache cleanup${dryRun ? ' (DRY RUN)' : ''}...`);
    const result = await monitor.cleanProfile({ dryRun });
    const freedMb = (result.freedBytes / (1024 * 1024)).toFixed(2);

    console.log(`\n✅ Cleanup finished:`);
    console.log(`Freed Space:   ${freedMb} MB`);
    console.log(`Files Purged:  ${result.deletedFilesCount}`);
    console.log(`Protected:     Cookies, IndexedDB, and active session credentials preserved.\n`);
  } else if (report.status !== 'optimal') {
    console.log(`💡 Recommendation: Run "npm run profile:health -- --clean" to safely purge ephemeral cache.\n`);
  }
}

main().catch(console.error);

import { loadConfig } from '../src/config/Config.js';
import { Logger } from '../src/logging/Logger.js';
import { SqliteDatabase } from '../src/persistence/Database.js';
import { WatcherRepository } from '../src/persistence/WatcherRepository.js';
import type { WatcherJob, WatcherConditionType } from '../src/watcher/types.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || 'list';

  const config = loadConfig();
  const logger = new Logger('error');
  const db = new SqliteDatabase({ path: config.databasePath, logger });
  const repo = new WatcherRepository(db);

  if (command === 'list') {
    const jobs = repo.getAllJobs();
    console.log(`\n================ Odysseus State Watchers (${jobs.length}) ================`);
    if (jobs.length === 0) {
      console.log('No state watchers registered. Use "npm run watcher add" to create one.');
    } else {
      console.table(
        jobs.map((j) => ({
          ID: j.id,
          Name: j.name,
          Status: j.status.toUpperCase(),
          Condition: `${j.conditionType} (${j.conditionTarget})`,
          Expected: j.conditionValue,
          Interval: `${j.intervalMs}ms`,
          Jitter: j.adaptiveJitter ? 'Yes' : 'No',
          'Last Checked': j.lastCheckedAt ? new Date(j.lastCheckedAt).toLocaleTimeString() : 'Never',
        }))
      );
    }
    console.log('===============================================================\n');
  } else if (command === 'add') {
    const nameArg = getArg(args, '--name') || `Watcher_${Date.now()}`;
    const urlArg = getArg(args, '--url') || 'http://127.0.0.1:8080';
    const typeArg = (getArg(args, '--type') || 'text_contains') as WatcherConditionType;
    const triggerArg = (getArg(args, '--trigger') || 'notify_hitl') as import('../src/watcher/types.js').WatcherTriggerType;
    const targetArg = getArg(args, '--target') || 'body';
    const valArg = getArg(args, '--val') || 'Ready';
    const intervalArg = parseInt(getArg(args, '--interval') || '10000', 10);
    const jitterArg = args.includes('--jitter');

    const job: WatcherJob = {
      id: `watcher_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: nameArg,
      targetUrl: urlArg,
      conditionType: typeArg,
      conditionTarget: targetArg,
      conditionValue: valArg,
      triggerType: triggerArg,
      triggerPayload: {},
      intervalMs: intervalArg,
      adaptiveJitter: jitterArg,
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    repo.saveJob(job);
    console.log(`\n✅ Watcher created successfully: [${job.id}] "${job.name}" on ${job.targetUrl}\n`);
  } else if (command === 'pause') {
    const id = args[1];
    if (!id) {
      console.error('Error: Please specify watcher ID to pause (e.g. npm run watcher pause <id>)');
      process.exit(1);
    }
    repo.updateJobStatus(id, 'paused');
    console.log(`\n⏸️ Watcher [${id}] paused.\n`);
  } else if (command === 'resume') {
    const id = args[1];
    if (!id) {
      console.error('Error: Please specify watcher ID to resume (e.g. npm run watcher resume <id>)');
      process.exit(1);
    }
    repo.updateJobStatus(id, 'active');
    console.log(`\n▶️ Watcher [${id}] resumed.\n`);
  } else if (command === 'delete') {
    const id = args[1];
    if (!id) {
      console.error('Error: Please specify watcher ID to delete (e.g. npm run watcher delete <id>)');
      process.exit(1);
    }
    repo.deleteJob(id);
    console.log(`\n🗑️ Watcher [${id}] deleted.\n`);
  } else {
    console.log(`
Usage: npm run watcher <command> [options]

Commands:
  list                 List all registered watcher daemons
  add                  Create a new watcher daemon
                       (--name <name> --url <url> --type <conditionType> --target <target> --val <value> --interval <ms> [--jitter])
  pause <id>           Pause an active watcher
  resume <id>          Resume a paused watcher
  delete <id>          Delete a watcher job
`);
  }

  db.close();
}

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return undefined;
}

main().catch(console.error);

import { loadConfig } from '../src/config/Config.js';
import { Logger } from '../src/logging/Logger.js';
import { SqliteDatabase } from '../src/persistence/Database.js';
import { TopologyRepository } from '../src/persistence/TopologyRepository.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const domainIdx = args.indexOf('--domain');
  const domainFilter = domainIdx !== -1 && domainIdx + 1 < args.length ? args[domainIdx + 1] : undefined;

  const config = loadConfig();
  const logger = new Logger('error');
  const db = new SqliteDatabase({ path: config.databasePath, logger });
  const repo = new TopologyRepository(db);

  const domains = domainFilter ? [domainFilter] : repo.getAllDomains();

  console.log(`\n================ Discovered Site Topology ================`);
  if (domains.length === 0) {
    console.log('No domains or routes mapped yet. Run agent tasks to discover site topology.');
  }

  for (const domain of domains) {
    const topology = repo.getTopology(domain);
    const nodes = Array.from(topology.nodes.values());
    console.log(`\n🌐 Domain: ${domain} (Coverage Score: ${(topology.coverageScore * 100).toFixed(0)}%, Root: ${topology.rootUrl})`);
    console.log(`--- Route Nodes (${nodes.length}) ---`);
    if (nodes.length === 0) {
      console.log('  No nodes recorded.');
    } else {
      console.table(
        nodes.map((n) => ({
          Path: n.path,
          Archetype: n.archetype,
          Depth: n.depth,
          Affordances: n.affordances.length,
          'Last Visited': n.visitedAt ? new Date(n.visitedAt).toLocaleTimeString() : 'Never',
        }))
      );
    }

    console.log(`--- Navigation Edges (${topology.edges.length}) ---`);
    if (topology.edges.length === 0) {
      console.log('  No edge transitions recorded.');
    } else {
      console.table(
        topology.edges.map((e) => ({
          From: e.sourcePath,
          To: e.targetPath,
          Type: e.transitionType,
          Weight: e.weight.toFixed(2),
          Trigger: e.triggerRole || e.triggerName || e.triggerSelector,
        }))
      );
    }
  }

  console.log(`\n==========================================================\n`);
  db.close();
}

main().catch(console.error);

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { TaskServer } from '../../src/api/TaskServer.js';
import { EventLogger } from '../../src/logging/EventLogger.js';
import { Logger } from '../../src/logging/Logger.js';
import { SqliteDatabase } from '../../src/persistence/Database.js';
import { TopologyRepository } from '../../src/persistence/TopologyRepository.js';
import { KnowledgeGraphRepository } from '../../src/persistence/KnowledgeGraphRepository.js';
import { KnowledgeGraph } from '../../src/graph/KnowledgeGraph.js';
import { WorkflowMacroRepository } from '../../src/persistence/WorkflowMacroRepository.js';
import { HyperparameterRepository } from '../../src/persistence/HyperparameterRepository.js';
import { WatcherRepository } from '../../src/persistence/WatcherRepository.js';
import { StateWatcherEngine } from '../../src/watcher/StateWatcherEngine.js';
import { ProfileHealthMonitor } from '../../src/stealth/ProfileHealthMonitor.js';
import type { OdysseusAgent } from '../../src/agent/Agent.js';
import type { WorkflowMacro } from '../../src/macros/types.js';

describe('Option 2: Level 5 Dashboard & Subsystem API Integration Suite', () => {
  let server: TaskServer;
  let port: number;
  let logger: Logger;
  let eventLogger: EventLogger;
  let db: SqliteDatabase;
  let tempProfileDir: string;

  let topologyRepo: TopologyRepository;
  let kgRepo: KnowledgeGraphRepository;
  let knowledgeGraph: KnowledgeGraph;
  let macroRepo: WorkflowMacroRepository;
  let hyperparameterRepo: HyperparameterRepository;
  let watcherRepo: WatcherRepository;
  let watcherEngine: StateWatcherEngine;
  let profileHealthMonitor: ProfileHealthMonitor;

  const mockExecuteMacro = vi.fn(async () => ({
    success: true,
    macroId: 'macro_test_1',
    executedSteps: 2,
    healedCount: 0,
    durationMs: 45,
  }));

  beforeAll(async () => {
    logger = new Logger('error');
    eventLogger = new EventLogger(logger);

    // Setup in-memory SQLite database
    db = new SqliteDatabase({ path: ':memory:', logger });

    // Setup temporary profile dir
    tempProfileDir = path.join(process.cwd(), 'data', `test-profile-${Date.now()}`);
    await fs.mkdir(path.join(tempProfileDir, 'Default', 'Cache'), { recursive: true });
    await fs.writeFile(path.join(tempProfileDir, 'Default', 'Cache', 'data_0'), 'cached-data');

    // Instantiate Level 5 persistence repositories
    topologyRepo = new TopologyRepository(db);
    kgRepo = new KnowledgeGraphRepository(db);
    knowledgeGraph = new KnowledgeGraph(kgRepo, logger);
    macroRepo = new WorkflowMacroRepository(db);
    hyperparameterRepo = new HyperparameterRepository(db);
    watcherRepo = new WatcherRepository(db);
    profileHealthMonitor = new ProfileHealthMonitor(tempProfileDir, logger);

    const mockBrowserManager = {
      isHealthy: () => true,
      getTabManager: () => ({
        getActiveTab: () => ({ id: 'tab_001', url: 'http://127.0.0.1:8080' }),
      }),
      getPageManager: () => ({
        getActivePage: () => ({
          screenshot: vi.fn(async () => Buffer.from('mock-png-bytes')),
        }),
      }),
    };

    const mockActionMutex = {
      runExclusive: async <T>(fn: () => Promise<T>): Promise<T> => fn(),
      isLocked: () => false,
    };

    watcherEngine = new StateWatcherEngine({
      browserManager: mockBrowserManager as unknown as import('../../src/browser/BrowserManager.js').BrowserManager,
      actionMutex: mockActionMutex as unknown as import('../../src/browser/ActionMutex.js').ActionMutex,
      watcherRepo,
      logger,
    });

    const mockMacroExecutor = {
      executeMacro: mockExecuteMacro,
    };

    const mockAgent = {
      getState: () => 'idle',
      getBrowserManager: () => mockBrowserManager,
      getTopologyRepo: () => topologyRepo,
      getKnowledgeGraph: () => knowledgeGraph,
      getMacroRepo: () => macroRepo,
      getMacroExecutor: () => mockMacroExecutor,
      getHyperparameterRepo: () => hyperparameterRepo,
      getWatcherRepo: () => watcherRepo,
      getWatcherEngine: () => watcherEngine,
      getProfileHealthMonitor: () => profileHealthMonitor,
    } as unknown as OdysseusAgent;

    server = new TaskServer({
      agent: mockAgent,
      logger,
      eventLogger,
    });

    port = await server.start(0);
    expect(port).toBeGreaterThan(0);
  });

  afterAll(async () => {
    await server.stop();
    db.close();
    await fs.rm(tempProfileDir, { recursive: true, force: true });
  });

  describe('Site Topology & Knowledge Graph Endpoints', () => {
    it('GET /api/topology should return empty topology initially and domain-filtered results after saving nodes', async () => {
      // 1. Initial empty
      const res1 = await fetch(`http://localhost:${port}/api/topology`);
      expect(res1.status).toBe(200);
      const data1 = await res1.json();
      expect(Array.isArray(data1.domains)).toBe(true);

      // 2. Seed a node & edge
      topologyRepo.saveNode({
        id: 'node_1',
        domain: 'mystore.local',
        path: '/products',
        pattern: '/products',
        title: 'Product Catalog',
        archetype: 'ecommerce',
        affordances: [{ type: 'action_button', elementId: 'btn_filter', role: 'button', name: 'Filter', selector: '#filter-btn' }],
        depth: 1,
        visitedAt: Date.now(),
        createdAt: Date.now(),
      });

      topologyRepo.saveEdge({
        id: 'edge_1',
        domain: 'mystore.local',
        sourcePath: '/',
        targetPath: '/products',
        transitionType: 'link_click',
        triggerSelector: '#nav-products',
        weight: 0.95,
        createdAt: Date.now(),
      });

      // 3. Fetch all topology
      const res2 = await fetch(`http://localhost:${port}/api/topology`);
      const data2 = await res2.json();
      expect(data2.domains).toContain('mystore.local');
      expect(data2.nodes.length).toBeGreaterThanOrEqual(1);
      expect(data2.edges.length).toBeGreaterThanOrEqual(1);

      // 4. Fetch specific domain topology
      const res3 = await fetch(`http://localhost:${port}/api/topology?domain=mystore.local`);
      const data3 = await res3.json();
      expect(data3.domain).toBe('mystore.local');
      expect(data3.nodes.length).toBe(1);
      expect(data3.edges.length).toBe(1);
    });

    it('GET /api/knowledge-graph should return seeded concepts and archetype relationships', async () => {
      const res = await fetch(`http://localhost:${port}/api/knowledge-graph`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.nodeCount).toBeGreaterThan(0);
      expect(data.nodes.length).toBeGreaterThan(0);
      expect(data.edges.length).toBeGreaterThan(0);
      const conceptNode = data.nodes.find((n: { type: string }) => n.type === 'concept');
      expect(conceptNode).toBeDefined();
    });
  });

  describe('Workflow Macro Subsystem Endpoints', () => {
    const testMacro: WorkflowMacro = {
      id: 'macro_test_1',
      domain: 'mystore.local',
      intentKey: 'add_to_cart',
      parameterKeys: ['productId'],
      steps: [
        {
          stepNumber: 1,
          actionTemplate: { action: 'navigate', url: 'http://mystore.local/items/{{productId}}' },
        },
        {
          stepNumber: 2,
          actionTemplate: { action: 'click', selector: '#add-cart-btn' },
        },
      ],
      status: 'verified',
      successCount: 3,
      failureCount: 0,
      healingCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    it('GET /api/macros should list all registered workflow macros', async () => {
      macroRepo.saveMacro(testMacro);

      const res = await fetch(`http://localhost:${port}/api/macros`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.macros)).toBe(true);
      const found = data.macros.find((m: WorkflowMacro) => m.id === 'macro_test_1');
      expect(found).toBeDefined();
      expect(found.intentKey).toBe('add_to_cart');
    });

    it('POST /api/macros/:id/replay should execute the parameterized macro', async () => {
      const res = await fetch(`http://localhost:${port}/api/macros/macro_test_1/replay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parameters: { productId: 'item_42' } }),
      });

      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result.success).toBe(true);
      expect(mockExecuteMacro).toHaveBeenCalled();
    });

    it('DELETE /api/macros/:id should delete the workflow macro', async () => {
      const res = await fetch(`http://localhost:${port}/api/macros/macro_test_1`, {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(macroRepo.getMacro('macro_test_1')).toBeNull();
    });
  });

  describe('State Watchers Endpoints', () => {
    let createdWatcherId: string;

    it('POST /api/watchers should register a new active watcher daemon', async () => {
      const res = await fetch(`http://localhost:${port}/api/watchers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Flash Sale Monitor',
          targetUrl: 'http://127.0.0.1:8080/deals',
          conditionType: 'text_contains',
          conditionTarget: '#discount-badge',
          conditionValue: '50% OFF',
          triggerType: 'notify_hitl',
          intervalMs: 15000,
          adaptiveJitter: true,
        }),
      });

      expect(res.status).toBe(201);
      const job = await res.json();
      expect(job.id).toBeDefined();
      expect(job.name).toBe('Flash Sale Monitor');
      expect(job.status).toBe('active');
      createdWatcherId = job.id;
    });

    it('GET /api/watchers should list all registered watcher daemons', async () => {
      const res = await fetch(`http://localhost:${port}/api/watchers`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.watchers)).toBe(true);
      const found = data.watchers.find((w: { id: string }) => w.id === createdWatcherId);
      expect(found).toBeDefined();
      expect(found.status).toBe('active');
    });

    it('POST /api/watchers/:id/pause and /resume should toggle watcher status', async () => {
      // Pause
      const pauseRes = await fetch(`http://localhost:${port}/api/watchers/${createdWatcherId}/pause`, {
        method: 'POST',
      });
      expect(pauseRes.status).toBe(200);
      const pauseData = await pauseRes.json();
      expect(pauseData.status).toBe('paused');

      const jobPaused = watcherRepo.getJob(createdWatcherId);
      expect(jobPaused?.status).toBe('paused');

      // Resume
      const resumeRes = await fetch(`http://localhost:${port}/api/watchers/${createdWatcherId}/resume`, {
        method: 'POST',
      });
      expect(resumeRes.status).toBe(200);
      const resumeData = await resumeRes.json();
      expect(resumeData.status).toBe('active');

      const jobResumed = watcherRepo.getJob(createdWatcherId);
      expect(jobResumed?.status).toBe('active');
    });

    it('DELETE /api/watchers/:id should remove the watcher job', async () => {
      const res = await fetch(`http://localhost:${port}/api/watchers/${createdWatcherId}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(watcherRepo.getJob(createdWatcherId)).toBeNull();
    });
  });

  describe('Stealth Profile Health & Optimization Endpoints', () => {
    it('GET /api/stealth/profile-health should return storage health metrics', async () => {
      const res = await fetch(`http://localhost:${port}/api/stealth/profile-health`);
      expect(res.status).toBe(200);
      const report = await res.json();
      expect(report.profileDir).toBe(tempProfileDir);
      expect(report.diskUsageBytes).toBeGreaterThanOrEqual(0);
      expect(report.status).toBe('optimal');
    });

    it('POST /api/stealth/profile-clean should purge ephemeral cache files', async () => {
      const res = await fetch(`http://localhost:${port}/api/stealth/profile-clean`, {
        method: 'POST',
      });
      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result.deletedFilesCount).toBeGreaterThanOrEqual(1);
      expect(result.freedBytes).toBeGreaterThanOrEqual(1);
    });

    it('GET /api/optimization/hyperparameters should return parameters list or domain effective parameters', async () => {
      hyperparameterRepo.saveParams({
        id: 'param_mystore',
        domainOrArchetype: 'mystore.local',
        riskAversionFactor: 0.85,
        maxRetries: 4,
        tokenBudget: 3500,
        frustrationThreshold: 3,
        promptDirectives: ['Prioritize direct cart actions'],
        sampleCount: 5,
        successCount: 5,
        updatedAt: new Date().toISOString(),
      });

      // 1. All hyperparameters
      const allRes = await fetch(`http://localhost:${port}/api/optimization/hyperparameters`);
      expect(allRes.status).toBe(200);
      const allData = await allRes.json();
      expect(Array.isArray(allData.hyperparameters)).toBe(true);
      expect(allData.hyperparameters.length).toBeGreaterThanOrEqual(1);

      // 2. Domain effective
      const domainRes = await fetch(`http://localhost:${port}/api/optimization/hyperparameters?domain=mystore.local`);
      expect(domainRes.status).toBe(200);
      const domainData = await domainRes.json();
      expect(domainData.effective).toBeDefined();
      expect(domainData.effective.riskAversionFactor).toBe(0.85);
    });
  });

  describe('Static Web Dashboard Assets', () => {
    it('GET / should serve the HTML dashboard containing Level 5 tabs and scripts', async () => {
      const res = await fetch(`http://localhost:${port}/`);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/html');
      const html = await res.text();
      expect(html).toContain('Mission Control');
      expect(html).toContain('Site Topology & KG');
      expect(html).toContain('tab-topology');
      expect(html).toContain('tab-macros');
      expect(html).toContain('tab-watchers');
      expect(html).toContain('tab-stealth');
      expect(html).toContain('dashboard.js');
    });

    it('GET /style.css and /dashboard.js should serve dashboard assets', async () => {
      const cssRes = await fetch(`http://localhost:${port}/style.css`);
      expect(cssRes.status).toBe(200);
      expect(cssRes.headers.get('Content-Type')).toContain('text/css');

      const jsRes = await fetch(`http://localhost:${port}/dashboard.js`);
      expect(jsRes.status).toBe(200);
      expect(jsRes.headers.get('Content-Type')).toContain('javascript');
    });
  });
});

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OdysseusAgent, Task, AgentResult } from '../agent/Agent.js';
import type { EventLogger, EventPayload } from '../logging/EventLogger.js';
import type { Logger } from '../logging/Logger.js';
import type { WatcherJob, WatcherConditionType, WatcherTriggerType } from '../watcher/types.js';
import type { WorkflowMacro } from '../macros/types.js';

export interface TaskServerOptions {
  agent: OdysseusAgent;
  logger?: Logger;
  eventLogger?: EventLogger;
  port?: number;
  publicDir?: string;
}

export interface ApiTaskRecord {
  id: string;
  goal: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'blocked' | 'timeout';
  stepCount: number;
  maxSteps: number;
  maxDurationMs?: number;
  createdAt: string;
  completedAt?: string;
  durationMs?: number;
  summary?: string;
  findings?: unknown[];
  error?: string | null;
}

export class TaskServer {
  private server: Server | null = null;
  private agent: OdysseusAgent;
  private logger?: Logger;
  private eventLogger?: EventLogger;
  private port: number;
  private publicDir: string;
  private tasks: Map<string, ApiTaskRecord> = new Map();
  private deliberations: Map<string, unknown[]> = new Map();
  private activeTaskId: string | null = null;
  private sseClients: Set<ServerResponse> = new Set();
  private sseHeartbeatTimer: NodeJS.Timeout | null = null;
  private boundEventWildcardListener: ((data: EventPayload) => void) | null = null;

  constructor(options: TaskServerOptions) {
    this.agent = options.agent;
    this.logger = options.logger;
    this.eventLogger = options.eventLogger;
    this.port = options.port ?? 3000;

    // Resolve public dir relative to module URL if not explicitly specified
    this.publicDir =
      options.publicDir || fileURLToPath(new URL('./public', import.meta.url));

    this.setupEventListener();
  }

  private setupEventListener(): void {
    if (!this.eventLogger) return;

    this.boundEventWildcardListener = (eventData: EventPayload) => {
      if (
        eventData.event === 'agent.deliberation' &&
        eventData.payload &&
        typeof eventData.payload.taskId === 'string'
      ) {
        const tid = eventData.payload.taskId as string;
        const list = this.deliberations.get(tid) || [];
        list.push(eventData.payload);
        this.deliberations.set(tid, list);
      }
      this.broadcastSSE(eventData.event, eventData);
    };

    this.eventLogger.on('*', this.boundEventWildcardListener);
  }

  /**
   * Starts HTTP server on the designated or ephemeral port.
   */
  public async start(port?: number): Promise<number> {
    const targetPort = port !== undefined ? port : this.port;

    return new Promise((resolve, reject) => {
      const srv = createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          this.logger?.error('TaskServer', `Unhandled HTTP error: ${String(err)}`);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal Server Error' }));
          }
        });
      });

      srv.on('error', (err) => {
        this.logger?.error('TaskServer', `Server socket error: ${err.message}`);
        reject(err);
      });

      srv.listen(targetPort, () => {
        const addr = srv.address();
        const actualPort = typeof addr === 'object' && addr !== null ? addr.port : targetPort;
        this.port = actualPort;
        this.server = srv;
        this.startSSEHeartbeat();
        this.logger?.info('TaskServer', `Task API and Dashboard running on port ${actualPort}`);
        resolve(actualPort);
      });
    });
  }

  /**
   * Gracefully shuts down the HTTP server and terminates active SSE connections.
   */
  public async stop(): Promise<void> {
    if (this.sseHeartbeatTimer) {
      clearInterval(this.sseHeartbeatTimer);
      this.sseHeartbeatTimer = null;
    }

    if (this.eventLogger && this.boundEventWildcardListener) {
      this.eventLogger.off('*', this.boundEventWildcardListener);
      this.boundEventWildcardListener = null;
    }

    // Close all open SSE connections
    for (const client of this.sseClients) {
      try {
        client.end();
      } catch {
        // Ignore client teardown error
      }
    }
    this.sseClients.clear();

    if (!this.server) return;

    return new Promise((resolve) => {
      this.server?.close(() => {
        this.server = null;
        this.logger?.info('TaskServer', 'HTTP server stopped cleanly');
        resolve();
      });
    });
  }

  public getPort(): number {
    return this.port;
  }

  private startSSEHeartbeat(): void {
    if (this.sseHeartbeatTimer) clearInterval(this.sseHeartbeatTimer);
    this.sseHeartbeatTimer = setInterval(() => {
      for (const client of this.sseClients) {
        try {
          client.write(': ping\n\n');
        } catch {
          this.sseClients.delete(client);
        }
      }
    }, 15000);
  }

  public broadcastSSE(eventType: string, data: unknown): void {
    const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.sseClients) {
      try {
        client.write(payload);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parsedUrl = new URL(req.url || '/', `http://localhost:${this.port}`);
    const pathname = parsedUrl.pathname;
    const method = (req.method || 'GET').toUpperCase();

    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Support optional /api prefix for task endpoints
    const taskPath = pathname.startsWith('/api/tasks') ? pathname.slice(4) : pathname;

    // 1. Task API Endpoints
    if (taskPath === '/tasks' && method === 'POST') {
      return this.handleCreateTask(req, res);
    }

    if (taskPath.startsWith('/tasks/') && method === 'POST' && taskPath.endsWith('/cancel')) {
      const taskId = taskPath.slice('/tasks/'.length, -'/cancel'.length);
      return this.handleCancelTask(taskId, res);
    }

    if (taskPath.startsWith('/tasks/') && method === 'POST' && taskPath.endsWith('/resolve-intervention')) {
      const taskId = taskPath.slice('/tasks/'.length, -'/resolve-intervention'.length);
      return this.handleResolveIntervention(taskId, res);
    }

    if (taskPath.startsWith('/tasks/') && method === 'GET' && taskPath.endsWith('/screenshot')) {
      return this.handleScreenshot(res);
    }

    if (taskPath.startsWith('/tasks/') && method === 'GET' && taskPath.endsWith('/deliberation')) {
      const taskId = taskPath.slice('/tasks/'.length, -'/deliberation'.length);
      return this.handleGetDeliberations(taskId, res);
    }

    if (taskPath.startsWith('/tasks/') && method === 'GET') {
      const taskId = taskPath.slice('/tasks/'.length);
      return this.handleGetTask(taskId, res);
    }

    if (taskPath === '/tasks' && method === 'GET') {
      return this.handleListTasks(res);
    }

    // 2. Real-time Event Stream (SSE)
    if (pathname === '/events' && method === 'GET') {
      return this.handleSSE(req, res);
    }

    // 3. Level 5 APIs
    if (pathname === '/api/topology' && method === 'GET') {
      return this.handleGetTopology(req, res);
    }

    if (pathname === '/api/knowledge-graph' && method === 'GET') {
      return this.handleGetKnowledgeGraph(res);
    }

    if (pathname === '/api/macros' && method === 'GET') {
      return this.handleListMacros(res);
    }

    if (pathname.startsWith('/api/macros/') && pathname.endsWith('/replay') && method === 'POST') {
      const macroId = pathname.slice('/api/macros/'.length, -'/replay'.length);
      return this.handleReplayMacro(macroId, req, res);
    }

    if (pathname.startsWith('/api/macros/') && method === 'DELETE') {
      const macroId = pathname.slice('/api/macros/'.length);
      return this.handleDeleteMacro(macroId, res);
    }

    if (pathname === '/api/watchers' && method === 'GET') {
      return this.handleListWatchers(res);
    }

    if (pathname === '/api/watchers' && method === 'POST') {
      return this.handleCreateWatcher(req, res);
    }

    if (pathname.startsWith('/api/watchers/') && pathname.endsWith('/pause') && method === 'POST') {
      const watcherId = pathname.slice('/api/watchers/'.length, -'/pause'.length);
      return this.handlePauseWatcher(watcherId, res);
    }

    if (pathname.startsWith('/api/watchers/') && pathname.endsWith('/resume') && method === 'POST') {
      const watcherId = pathname.slice('/api/watchers/'.length, -'/resume'.length);
      return this.handleResumeWatcher(watcherId, res);
    }

    if (pathname.startsWith('/api/watchers/') && method === 'DELETE') {
      const watcherId = pathname.slice('/api/watchers/'.length);
      return this.handleDeleteWatcher(watcherId, res);
    }

    if (pathname === '/api/stealth/profile-health' && method === 'GET') {
      return this.handleGetProfileHealth(res);
    }

    if (pathname === '/api/stealth/profile-clean' && method === 'POST') {
      return this.handleCleanProfile(res);
    }

    if (pathname === '/api/optimization/hyperparameters' && method === 'GET') {
      return this.handleGetHyperparameters(req, res);
    }

    // 4. System Status & Diagnostics
    if (pathname === '/api/status' && method === 'GET') {
      return this.handleStatus(res);
    }

    if (pathname === '/api/screenshot' && method === 'GET') {
      return this.handleScreenshot(res);
    }

    // 5. Static Dashboard Assets
    if (method === 'GET') {
      return this.handleStatic(pathname, res);
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
  }

  private async handleCreateTask(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let bodyText = '';
    req.on('data', (chunk) => {
      bodyText += chunk;
    });

    await new Promise<void>((resolve) => req.on('end', resolve));

    let body: { goal?: string; maxSteps?: number; maxDurationMs?: number; customInstructions?: string };
    try {
      body = JSON.parse(bodyText || '{}');
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    if (!body.goal || typeof body.goal !== 'string' || body.goal.trim().length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Task goal is required and must be a non-empty string' }));
      return;
    }

    // Single Agent / Task Invariant Check
    const agentState = this.agent.getState();
    const isBusy = agentState !== 'idle' && agentState !== 'completed' && agentState !== 'failed' && agentState !== 'stopped';
    if (isBusy || this.activeTaskId !== null) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'Another task is currently running. Exactly one active task is allowed at a time.',
        })
      );
      return;
    }

    const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const maxSteps = body.maxSteps ?? 50;
    const maxDurationMs = body.maxDurationMs ?? 600000;

    const taskRecord: ApiTaskRecord = {
      id: taskId,
      goal: body.goal.trim(),
      status: 'running',
      stepCount: 0,
      maxSteps,
      maxDurationMs,
      createdAt: new Date().toISOString(),
      findings: [],
      error: null,
    };

    this.tasks.set(taskId, taskRecord);
    this.activeTaskId = taskId;

    // Broadcast domain event
    this.broadcastSSE('task.created', { taskId, goal: taskRecord.goal });

    // Respond immediately with 201 Created
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        taskId,
        status: 'queued',
        createdAt: taskRecord.createdAt,
      })
    );

    // Launch execution asynchronously
    const taskInput: Task = {
      id: taskId,
      goal: taskRecord.goal,
      maxSteps,
      maxDurationMs,
      customInstructions: body.customInstructions,
    };

    (async () => {
      try {
        const result = await this.agent.run(taskInput);
        const record = this.tasks.get(taskId);
        if (record) {
          record.status = result.status;
          record.stepCount = result.steps;
          record.durationMs = result.durationMs;
          record.findings = result.findings || [];
          record.summary = result.summary;
          record.completedAt = new Date().toISOString();
        }
        this.broadcastSSE('task.completed', { taskId, status: result.status, steps: result.steps });
      } catch (err: unknown) {
        const record = this.tasks.get(taskId);
        if (record) {
          record.status = 'failed';
          record.error = err instanceof Error ? err.message : String(err);
          record.completedAt = new Date().toISOString();
        }
        this.broadcastSSE('task.failed', { taskId, error: record?.error });
      } finally {
        if (this.activeTaskId === taskId) {
          this.activeTaskId = null;
        }
      }
    })();
  }

  private handleGetTask(taskId: string, res: ServerResponse): void {
    const record = this.tasks.get(taskId);
    if (!record) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Task not found' }));
      return;
    }

    // Dynamic enrichment for active running task
    let stepCount = record.stepCount;
    let findings = record.findings || [];

    if (record.status === 'running' && this.activeTaskId === taskId) {
      try {
        const taskMemory = this.agent.getMemoryManager().getTaskMemory();
        stepCount = taskMemory.getAttemptedActions().length;
        findings = this.agent.getMemoryManager().getResearchMemory().getFindings();
      } catch {
        // Fallback to record values
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id: record.id,
        goal: record.goal,
        status: record.status,
        stepCount,
        maxSteps: record.maxSteps,
        findings,
        summary: record.summary,
        error: record.error,
        createdAt: record.createdAt,
        completedAt: record.completedAt,
        durationMs: record.durationMs,
      })
    );
  }

  private handleListTasks(res: ServerResponse): void {
    const list = Array.from(this.tasks.values());
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(list));
  }

  private async handleCancelTask(taskId: string, res: ServerResponse): Promise<void> {
    const record = this.tasks.get(taskId);
    if (!record) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Task not found' }));
      return;
    }

    if (record.status !== 'running' && record.status !== 'queued') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ taskId, status: record.status }));
      return;
    }

    try {
      await this.agent.stop();
      record.status = 'cancelled';
      record.completedAt = new Date().toISOString();
      this.broadcastSSE('task.cancelled', { taskId });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ taskId, status: 'cancelled' }));
    } catch (err: unknown) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Failed to cancel task: ${String(err)}` }));
    }
  }

  private handleResolveIntervention(taskId: string, res: ServerResponse): void {
    const isTargetTask = this.activeTaskId === taskId || !this.activeTaskId;
    const isWaiting = this.agent.getState() === 'waiting_human_intervention';

    if (!isWaiting || !isTargetTask) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: false,
          error: 'Agent is not currently waiting for human intervention on this task',
          state: this.agent.getState(),
        })
      );
      return;
    }

    const resolved = typeof this.agent.resolveIntervention === 'function'
      ? this.agent.resolveIntervention(taskId)
      : false;

    if (resolved) {
      this.broadcastSSE('agent.intervention_resolved', { taskId });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          message: 'Human intervention confirmed. Agent task resuming.',
          taskId,
        })
      );
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Could not resolve intervention on agent' }));
    }
  }

  private handleGetDeliberations(taskId: string, res: ServerResponse): void {
    const list = this.deliberations.get(taskId) || [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ taskId, count: list.length, deliberations: list }));
  }

  private handleSSE(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    res.write(`event: ready\ndata: ${JSON.stringify({ status: 'connected', timestamp: new Date().toISOString() })}\n\n`);

    this.sseClients.add(res);

    req.on('close', () => {
      this.sseClients.delete(res);
    });
  }

  private handleStatus(res: ServerResponse): void {
    let browserHealthy = false;
    let activeTab = null;

    try {
      const bm = this.agent.getBrowserManager?.();
      browserHealthy = bm?.isHealthy() ?? false;
      const tm = bm?.getTabManager();
      activeTab = tm?.getActiveTab() ?? null;
    } catch {
      // Browser manager may not be initialized
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        agentState: this.agent.getState(),
        activeTaskId: this.activeTaskId,
        browserHealthy,
        activeTab,
        totalTasks: this.tasks.size,
        timestamp: new Date().toISOString(),
      })
    );
  }

  private async handleScreenshot(res: ServerResponse): Promise<void> {
    try {
      const bm = this.agent.getBrowserManager?.();
      const pm = bm?.getPageManager();
      const activePage = pm?.getActivePage();

      if (!activePage) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No active browser page available' }));
        return;
      }

      const screenshotBuffer = await activePage.screenshot({ type: 'png' });
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': screenshotBuffer.length,
        'Cache-Control': 'no-cache',
      });
      res.end(screenshotBuffer);
    } catch (err: unknown) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Screenshot capture failed: ${String(err)}` }));
    }
  }

  private handleStatic(pathname: string, res: ServerResponse): void {
    if (pathname.includes('%00') || pathname.includes('\0')) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Bad Request');
      return;
    }

    let decodedPath = pathname;
    try {
      decodedPath = decodeURIComponent(pathname);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Bad Request');
      return;
    }

    const relativeFile = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
    const resolvedPublicDir = resolve(this.publicDir);
    const fullPath = resolve(resolvedPublicDir, relativeFile);

    // Enforce public directory boundary to eliminate path traversal
    if (!fullPath.startsWith(resolvedPublicDir)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    if (!existsSync(fullPath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    let contentType = 'text/plain';
    if (relativeFile.endsWith('.html')) contentType = 'text/html; charset=utf-8';
    else if (relativeFile.endsWith('.css')) contentType = 'text/css; charset=utf-8';
    else if (relativeFile.endsWith('.js')) contentType = 'application/javascript; charset=utf-8';
    else if (relativeFile.endsWith('.json')) contentType = 'application/json';
    else if (relativeFile.endsWith('.png')) contentType = 'image/png';
    else if (relativeFile.endsWith('.svg')) contentType = 'image/svg+xml';

    try {
      const fileContent = readFileSync(fullPath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(fileContent);
    } catch (err: unknown) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Internal error loading asset: ${String(err)}`);
    }
  }

  private async readJsonBody<T>(req: IncomingMessage): Promise<T | null> {
    let bodyText = '';
    req.on('data', (chunk) => {
      bodyText += chunk;
    });
    await new Promise<void>((resolve) => req.on('end', resolve));
    try {
      return JSON.parse(bodyText || '{}') as T;
    } catch {
      return null;
    }
  }

  private async handleGetTopology(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const topologyRepo = this.agent.getTopologyRepo();
      if (!topologyRepo) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ domains: [], nodes: [], edges: [] }));
        return;
      }

      const parsedUrl = new URL(req.url || '/', `http://localhost:${this.port}`);
      const domain = parsedUrl.searchParams.get('domain');

      if (domain) {
        const topology = topologyRepo.getTopology(domain);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            domain,
            rootUrl: topology.rootUrl,
            nodes: Array.from(topology.nodes.values()),
            edges: topology.edges,
            coverageScore: topology.coverageScore,
          })
        );
        return;
      }

      const domains = topologyRepo.getAllDomains();
      const nodes = topologyRepo.getAllNodes();
      const edges = topologyRepo.getAllEdges();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ domains, nodes, edges }));
    } catch (err: unknown) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Failed to fetch topology: ${String(err)}` }));
    }
  }

  private handleGetKnowledgeGraph(res: ServerResponse): void {
    try {
      const kg = this.agent.getKnowledgeGraph();
      const nodes = kg.getAllNodes();
      const edges = kg.getAllEdges();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          nodeCount: kg.getNodeCount(),
          nodes,
          edges,
        })
      );
    } catch (err: unknown) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Failed to fetch knowledge graph: ${String(err)}` }));
    }
  }

  private handleListMacros(res: ServerResponse): void {
    try {
      const macroRepo = this.agent.getMacroRepo();
      if (!macroRepo) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ macros: [] }));
        return;
      }
      const macros = macroRepo.listAllMacros();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ macros }));
    } catch (err: unknown) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Failed to list macros: ${String(err)}` }));
    }
  }

  private async handleReplayMacro(macroId: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const macroRepo = this.agent.getMacroRepo();
      const macroExecutor = this.agent.getMacroExecutor();
      if (!macroRepo || !macroExecutor) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Macro subsystem not initialized' }));
        return;
      }

      const macro = macroRepo.getMacro(macroId);
      if (!macro) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Macro [${macroId}] not found` }));
        return;
      }

      const bm = this.agent.getBrowserManager();
      const page = bm.getPageManager().getActivePage();
      const activeTab = bm.getTabManager().getActiveTab();
      const activeTabId = activeTab?.id || 'tab_1';
      if (!page) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No active browser tab available to replay macro' }));
        return;
      }

      const body = await this.readJsonBody<{ parameters?: Record<string, string> }>(req);
      const params = body?.parameters || {};

      const result = await macroExecutor.executeMacro(macro, params, {
        page,
        tabId: activeTabId,
        taskId: `macro_replay_${Date.now()}`,
      });

      this.broadcastSSE('macro.replayed', { macroId, result });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err: unknown) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Macro replay failed: ${String(err)}` }));
    }
  }

  private handleDeleteMacro(macroId: string, res: ServerResponse): void {
    try {
      const macroRepo = this.agent.getMacroRepo();
      if (!macroRepo) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Macro repository not initialized' }));
        return;
      }
      macroRepo.deleteMacro(macroId);
      this.broadcastSSE('macro.deleted', { macroId });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, deletedMacroId: macroId }));
    } catch (err: unknown) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Failed to delete macro: ${String(err)}` }));
    }
  }

  private handleListWatchers(res: ServerResponse): void {
    try {
      const watcherRepo = this.agent.getWatcherRepo();
      if (!watcherRepo) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ watchers: [] }));
        return;
      }
      const watchers = watcherRepo.getAllJobs();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ watchers }));
    } catch (err: unknown) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Failed to list watchers: ${String(err)}` }));
    }
  }

  private async handleCreateWatcher(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await this.readJsonBody<Partial<WatcherJob>>(req);
      if (!body || !body.name || !body.targetUrl || !body.conditionType) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing required watcher fields (name, targetUrl, conditionType)' }));
        return;
      }

      const watcherEngine = this.agent.getWatcherEngine();
      const watcherRepo = this.agent.getWatcherRepo();
      if (!watcherEngine || !watcherRepo) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Watcher engine not initialized' }));
        return;
      }

      const job: WatcherJob = {
        id: `watcher_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: body.name.trim(),
        targetUrl: body.targetUrl.trim(),
        conditionType: body.conditionType as WatcherConditionType,
        conditionTarget: body.conditionTarget || '',
        conditionValue: body.conditionValue || '',
        triggerType: (body.triggerType as WatcherTriggerType) || 'notify_hitl',
        triggerPayload: body.triggerPayload || {},
        intervalMs: Number(body.intervalMs) || 10000,
        adaptiveJitter: Boolean(body.adaptiveJitter),
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      watcherEngine.addJob(job);
      this.broadcastSSE('watcher.created', job);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(job));
    } catch (err: unknown) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Failed to create watcher: ${String(err)}` }));
    }
  }

  private handlePauseWatcher(watcherId: string, res: ServerResponse): void {
    try {
      const watcherEngine = this.agent.getWatcherEngine();
      const watcherRepo = this.agent.getWatcherRepo();
      if (!watcherEngine || !watcherRepo) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Watcher engine not initialized' }));
        return;
      }
      const job = watcherRepo.getJob(watcherId);
      if (!job) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Watcher [${watcherId}] not found` }));
        return;
      }
      watcherEngine.pauseJob(watcherId);
      this.broadcastSSE('watcher.updated', { id: watcherId, status: 'paused' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, id: watcherId, status: 'paused' }));
    } catch (err: unknown) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Failed to pause watcher: ${String(err)}` }));
    }
  }

  private handleResumeWatcher(watcherId: string, res: ServerResponse): void {
    try {
      const watcherEngine = this.agent.getWatcherEngine();
      const watcherRepo = this.agent.getWatcherRepo();
      if (!watcherEngine || !watcherRepo) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Watcher engine not initialized' }));
        return;
      }
      const job = watcherRepo.getJob(watcherId);
      if (!job) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Watcher [${watcherId}] not found` }));
        return;
      }
      watcherEngine.resumeJob(watcherId);
      this.broadcastSSE('watcher.updated', { id: watcherId, status: 'active' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, id: watcherId, status: 'active' }));
    } catch (err: unknown) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Failed to resume watcher: ${String(err)}` }));
    }
  }

  private handleDeleteWatcher(watcherId: string, res: ServerResponse): void {
    try {
      const watcherEngine = this.agent.getWatcherEngine();
      const watcherRepo = this.agent.getWatcherRepo();
      if (!watcherEngine || !watcherRepo) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Watcher engine not initialized' }));
        return;
      }
      watcherEngine.removeJob(watcherId);
      this.broadcastSSE('watcher.deleted', { id: watcherId });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, deletedWatcherId: watcherId }));
    } catch (err: unknown) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Failed to delete watcher: ${String(err)}` }));
    }
  }

  private async handleGetProfileHealth(res: ServerResponse): Promise<void> {
    try {
      const monitor = this.agent.getProfileHealthMonitor();
      const report = await monitor.inspectProfile();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(report));
    } catch (err: unknown) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Failed to inspect profile health: ${String(err)}` }));
    }
  }

  private async handleCleanProfile(res: ServerResponse): Promise<void> {
    try {
      const monitor = this.agent.getProfileHealthMonitor();
      const result = await monitor.cleanProfile({ dryRun: false });
      this.broadcastSSE('stealth.cleaned', result);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err: unknown) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Failed to clean profile: ${String(err)}` }));
    }
  }

  private handleGetHyperparameters(req: IncomingMessage, res: ServerResponse): void {
    try {
      const hyperRepo = this.agent.getHyperparameterRepo();
      if (!hyperRepo) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ hyperparameters: [] }));
        return;
      }

      const parsedUrl = new URL(req.url || '/', `http://localhost:${this.port}`);
      const domain = parsedUrl.searchParams.get('domain');
      const archetype = parsedUrl.searchParams.get('archetype');

      if (domain || archetype) {
        const effective = hyperRepo.getEffectiveParams(domain || undefined, archetype || undefined);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ effective }));
        return;
      }

      const all = hyperRepo.getAllParams();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ hyperparameters: all }));
    } catch (err: unknown) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Failed to fetch hyperparameters: ${String(err)}` }));
    }
  }
}

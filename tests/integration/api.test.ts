import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { TaskServer } from '../../src/api/TaskServer.js';
import { EventLogger } from '../../src/logging/EventLogger.js';
import { Logger } from '../../src/logging/Logger.js';
import { MemoryManager } from '../../src/memory/MemoryManager.js';
import type { OdysseusAgent, Task } from '../../src/agent/Agent.js';
import type { AgentState } from '../../src/agent/AgentState.js';

describe('Phase 12: Minimal Task API & Web Dashboard Integration', () => {
  let server: TaskServer;
  let port: number;
  let eventLogger: EventLogger;
  let logger: Logger;
  let mockMemoryManager: MemoryManager;
  let agentState: AgentState = 'idle';

  const mockAgent = {
    getState: () => agentState,
    run: vi.fn().mockImplementation(async (task: Task) => {
      agentState = 'acting';
      mockMemoryManager.getTaskMemory().setGoal(task.goal);
      mockMemoryManager.getTaskMemory().recordAction({
        actionType: 'navigate',
        success: true,
      });
      mockMemoryManager.getResearchMemory().addFinding({
        claim: 'Autonomous browser agents operate on state transitions.',
        sourceUrls: ['https://example.com/research'],
      });

      await new Promise((r) => setTimeout(r, 60));
      agentState = 'idle';
      return {
        taskId: task.id,
        status: 'completed' as const,
        summary: 'Task executed successfully in mock environment',
        steps: 1,
        durationMs: 60,
        findings: [
          {
            claim: 'Autonomous browser agents operate on state transitions.',
            sourceUrls: ['https://example.com/research'],
          },
        ],
      };
    }),
    stop: vi.fn().mockImplementation(async () => {
      agentState = 'stopped';
    }),
    getMemoryManager: () => mockMemoryManager,
    getBrowserManager: () => ({
      isHealthy: () => true,
      getTabManager: () => ({
        getActiveTab: () => ({
          id: 'tab_001',
          url: 'https://docs.odysseus.local',
          title: 'Odysseus Documentation',
          active: true,
          createdAt: new Date().toISOString(),
        }),
      }),
      getPageManager: () => ({
        getActivePage: () => null,
      }),
    }),
  } as unknown as OdysseusAgent;

  beforeAll(async () => {
    logger = new Logger('error');
    eventLogger = new EventLogger(logger);
    mockMemoryManager = new MemoryManager();

    server = new TaskServer({
      agent: mockAgent,
      logger,
      eventLogger,
    });

    // Start on ephemeral port
    port = await server.start(0);
    expect(port).toBeGreaterThan(0);
  });

  afterAll(async () => {
    await server.stop();
  });

  describe('Static Web Dashboard Endpoints', () => {
    it('should serve HTML dashboard at root URL (/)', async () => {
      const res = await fetch(`http://localhost:${port}/`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');

      const body = await res.text();
      expect(body).toContain('<!DOCTYPE html>');
      expect(body).toContain('Odysseus');
      expect(body).toContain('Mission Control');
      expect(body).toContain('Live Event Terminal');
    });

    it('should serve stylesheet at (/style.css)', async () => {
      const res = await fetch(`http://localhost:${port}/style.css`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/css');

      const body = await res.text();
      expect(body).toContain('--bg-primary');
      expect(body).toContain('.app-container');
    });

    it('should serve frontend controller at (/dashboard.js)', async () => {
      const res = await fetch(`http://localhost:${port}/dashboard.js`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/javascript');

      const body = await res.text();
      expect(body).toContain('EventSource');
      expect(body).toContain('connectSSE');
    });

    it('should return 404 for unknown static asset', async () => {
      const res = await fetch(`http://localhost:${port}/nonexistent.xyz`);
      expect(res.status).toBe(404);
    });

    it('should block path traversal attempts with 403 Forbidden', async () => {
      const res1 = await fetch(`http://localhost:${port}/../../../package.json`);
      expect([403, 404]).toContain(res1.status);

      const res2 = await fetch(`http://localhost:${port}/..%2F..%2F.env`);
      expect([403, 404]).toContain(res2.status);
    });

    it('should reject null byte injections with 400 Bad Request', async () => {
      const res = await fetch(`http://localhost:${port}/index.html%00.png`);
      expect(res.status).toBe(400);
    });
  });

  describe('System Status & Diagnostics API', () => {
    it('should return system state and active tab at GET /api/status', async () => {
      const res = await fetch(`http://localhost:${port}/api/status`);
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data).toHaveProperty('agentState');
      expect(data.browserHealthy).toBe(true);
      expect(data.activeTab?.url).toBe('https://docs.odysseus.local');
      expect(data.activeTab?.title).toBe('Odysseus Documentation');
    });

    it('should handle screenshot endpoint gracefully when no page exists', async () => {
      const res = await fetch(`http://localhost:${port}/api/screenshot`);
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe('No active browser page available');
    });
  });

  describe('Task Submission & Management API', () => {
    let createdTaskId: string;

    it('should reject task submission without a goal (400 Bad Request)', async () => {
      const res = await fetch(`http://localhost:${port}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: '' }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('goal is required');
    });

    it('should reject malformed JSON body (400 Bad Request)', async () => {
      const res = await fetch(`http://localhost:${port}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'bad json format',
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Invalid JSON body');
    });

    it('should accept a valid task and return 201 Created', async () => {
      const res = await fetch(`http://localhost:${port}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal: 'Research enterprise license pricing',
          maxSteps: 25,
          maxDurationMs: 120000,
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();

      expect(data.taskId).toMatch(/^task_/);
      expect(data.status).toBe('queued');
      expect(data.createdAt).toBeDefined();

      createdTaskId = data.taskId;
    });

    it('should reject concurrent task when task is running (409 Conflict)', async () => {
      // While previous task is running in background (with 60ms delay)
      const res = await fetch(`http://localhost:${port}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: 'Concurrent goal' }),
      });

      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toContain('Another task is currently running');
    });

    it('should inspect task status and details via GET /tasks/:id', async () => {
      // Wait for task to finish execution
      await new Promise((r) => setTimeout(r, 100));

      const res = await fetch(`http://localhost:${port}/tasks/${createdTaskId}`);
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.id).toBe(createdTaskId);
      expect(data.goal).toBe('Research enterprise license pricing');
      expect(data.status).toBe('completed');
      expect(data.stepCount).toBeGreaterThanOrEqual(1);
      expect(data.maxSteps).toBe(25);
      expect(data.findings).toHaveLength(1);
      expect(data.findings[0].claim).toContain('Autonomous browser agents');
    });

    it('should return 404 for nonexistent task ID', async () => {
      const res = await fetch(`http://localhost:${port}/tasks/task_nonexistent_999`);
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe('Task not found');
    });

    it('should list all tasks via GET /tasks', async () => {
      const res = await fetch(`http://localhost:${port}/tasks`);
      expect(res.status).toBe(200);
      const list = await res.json();

      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThanOrEqual(1);
      expect(list.some((t: { id: string }) => t.id === createdTaskId)).toBe(true);
    });

    it('should handle task cancellation via POST /tasks/:id/cancel', async () => {
      // Launch a new task
      const createRes = await fetch(`http://localhost:${port}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: 'Task to be aborted' }),
      });
      const createData = await createRes.json();
      const cancelTargetId = createData.taskId;

      const cancelRes = await fetch(`http://localhost:${port}/tasks/${cancelTargetId}/cancel`, {
        method: 'POST',
      });
      expect(cancelRes.status).toBe(200);
      const cancelData = await cancelRes.json();

      expect(cancelData.taskId).toBe(cancelTargetId);
      expect(cancelData.status).toBe('cancelled');
      expect(mockAgent.stop).toHaveBeenCalled();
    });

    it('should return 404 when cancelling nonexistent task', async () => {
      const res = await fetch(`http://localhost:${port}/tasks/task_ghost/cancel`, {
        method: 'POST',
      });
      expect(res.status).toBe(404);
    });
  });

  describe('Server-Sent Events (SSE) Stream', () => {
    it('should connect to /events and receive handshake and domain events', async () => {
      // Ensure any pending task completion events from previous test have settled
      await new Promise((r) => setTimeout(r, 100));

      const sseRes = await fetch(`http://localhost:${port}/events`);
      expect(sseRes.status).toBe(200);
      expect(sseRes.headers.get('content-type')).toContain('text/event-stream');

      const reader = sseRes.body?.getReader();
      expect(reader).toBeDefined();

      if (!reader) return;

      // 1. Read initial 'ready' handshake event
      const chunk1 = await reader.read();
      const text1 = new TextDecoder().decode(chunk1.value);
      expect(text1).toContain('event: ready');
      expect(text1).toContain('connected');

      // 2. Emit a domain event through eventLogger and verify broadcast
      setTimeout(() => {
        eventLogger.emit('agent.state_changed', { state: 'acting' });
      }, 20);

      let receivedText = '';
      const deadline = Date.now() + 2000;
      while (!receivedText.includes('event: agent.state_changed') && Date.now() < deadline) {
        const chunk = await reader.read();
        if (chunk.done) break;
        receivedText += new TextDecoder().decode(chunk.value);
      }

      expect(receivedText).toContain('event: agent.state_changed');
      expect(receivedText).toContain('acting');

      // Clean up stream
      await reader.cancel();
    });
  });
});

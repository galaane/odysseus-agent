import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { TaskServer } from '../../src/api/TaskServer.js';
import { EventLogger } from '../../src/logging/EventLogger.js';
import { Logger } from '../../src/logging/Logger.js';
import type { OdysseusAgent } from '../../src/agent/Agent.js';
import type { AgentState } from '../../src/agent/AgentState.js';

describe('Phase 18: Live Interactive Dashboard & Visual HITL Web Console', () => {
  let server: TaskServer;
  let port: number;
  let eventLogger: EventLogger;
  let logger: Logger;
  let agentState: AgentState = 'idle';
  const resolveInterventionMock = vi.fn(() => true);

  const mockActivePage = {
    screenshot: vi.fn(async () => Buffer.from('mock-png-bytes')),
  };

  const mockAgent = {
    getState: () => agentState,
    resolveIntervention: resolveInterventionMock,
    run: vi.fn(),
    stop: vi.fn(),
    getMemoryManager: () => ({}),
    getBrowserManager: () => ({
      isHealthy: () => true,
      getTabManager: () => ({
        getActiveTab: () => ({ id: 'tab_001', url: 'https://example.com' }),
      }),
      getPageManager: () => ({
        getActivePage: () => mockActivePage,
      }),
    }),
  } as unknown as OdysseusAgent;

  beforeAll(async () => {
    logger = new Logger('error');
    eventLogger = new EventLogger(logger);

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
  });

  describe('HITL Intervention Resolution Webhook', () => {
    it('should reject resolve-intervention if agent is not in waiting_human_intervention state', async () => {
      agentState = 'idle';
      const res = await fetch(`http://localhost:${port}/api/tasks/task_test_1/resolve-intervention`, {
        method: 'POST',
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('not currently waiting for human intervention');
    });

    it('should successfully resolve intervention when agent is in waiting_human_intervention state', async () => {
      agentState = 'waiting_human_intervention';
      const res = await fetch(`http://localhost:${port}/api/tasks/task_test_1/resolve-intervention`, {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.message).toContain('Human intervention confirmed');
      expect(resolveInterventionMock).toHaveBeenCalled();
    });
  });

  describe('Deliberation Tracking & History Endpoint', () => {
    it('should record agent.deliberation events and return them via GET /api/tasks/:id/deliberation', async () => {
      const taskId = 'task_delib_99';
      eventLogger.emit('agent.deliberation', {
        taskId,
        step: 1,
        deliberation: {
          observation_analysis: 'Detected payment form with Stripe iframe',
          encountered_obstacles: '3D Secure modal overlay active',
          alternative_considered: 'Wait for user authentication',
          risk_assessment: 'Do not click outside boundary',
        },
        reasoning: 'Waiting for manual 3D secure completion',
        status: 'waiting_human_intervention',
      });

      const res = await fetch(`http://localhost:${port}/api/tasks/${taskId}/deliberation`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.taskId).toBe(taskId);
      expect(data.count).toBe(1);
      expect(data.deliberations[0].deliberation.encountered_obstacles).toBe('3D Secure modal overlay active');
    });
  });

  describe('Task-Scoped Live Screenshot Endpoint', () => {
    it('should serve viewport screenshot via /api/tasks/:id/screenshot', async () => {
      const res = await fetch(`http://localhost:${port}/api/tasks/task_123/screenshot`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/png');
      const buffer = await res.arrayBuffer();
      expect(buffer.byteLength).toBeGreaterThan(0);
    });
  });

  describe('Dashboard UI Elements Verification', () => {
    it('should serve HTML with HITL banner and System 2 Deliberation card', async () => {
      const res = await fetch(`http://localhost:${port}/`);
      expect(res.status).toBe(200);
      const html = await res.text();

      expect(html).toContain('id="hitl-banner"');
      expect(html).toContain('id="btn-resolve-intervention"');
      expect(html).toContain('id="deliberation-panel"');
      expect(html).toContain('System 2 Deliberation');
    });

    it('should serve style.css with HITL and Deliberation styles', async () => {
      const res = await fetch(`http://localhost:${port}/style.css`);
      expect(res.status).toBe(200);
      const css = await res.text();

      expect(css).toContain('.hitl-banner');
      expect(css).toContain('.btn-warning');
      expect(css).toContain('.deliberation-panel');
      expect(css).toContain('.deliberation-tag');
    });

    it('should serve dashboard.js with deliberation and HITL handling', async () => {
      const res = await fetch(`http://localhost:${port}/dashboard.js`);
      expect(res.status).toBe(200);
      const js = await res.text();

      expect(js).toContain('agent.deliberation');
      expect(js).toContain('agent.intervention_required');
      expect(js).toContain('resolve-intervention');
    });
  });
});

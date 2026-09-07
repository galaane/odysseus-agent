import { describe, it, expect, beforeEach } from 'vitest';
import { NetworkPayloadHarvester } from '../../src/research/NetworkPayloadHarvester.js';
import { NetworkObserver } from '../../src/observer/NetworkObserver.js';
import { HarvestPayloadHandler } from '../../src/actions/handlers/HarvestPayloadHandler.js';
import { ActionRegistry } from '../../src/actions/ActionRegistry.js';
import { ActionValidator } from '../../src/actions/ActionValidator.js';
import { MemoryManager } from '../../src/memory/MemoryManager.js';
import { SqliteDatabase } from '../../src/persistence/Database.js';
import { ResearchRepository } from '../../src/persistence/ResearchRepository.js';
import { Logger } from '../../src/logging/Logger.js';
import type { Page } from 'playwright-core';
import type { ActionExecutionContext } from '../../src/actions/ActionExecutionContext.js';
import type { BrowserManager } from '../../src/browser/BrowserManager.js';

describe('Phase 30: Direct Network Payload Harvesting', () => {
  let harvester: NetworkPayloadHarvester;

  beforeEach(() => {
    harvester = new NetworkPayloadHarvester();
  });

  describe('NetworkPayloadHarvester - Querying & Extraction', () => {
    const sampleData = {
      status: 'success',
      meta: { page: 1, total: 2 },
      data: {
        products: [
          { id: 'p_101', name: 'Ergonomic Keyboard', price: 99.99, tags: ['hardware', 'ergonomic'] },
          { id: 'p_102', name: 'Vertical Mouse', price: 59.99, tags: ['hardware', 'wireless'] },
        ],
      },
    };

    it('should query top-level fields', () => {
      expect(harvester.queryPath(sampleData, 'status')).toBe('success');
    });

    it('should query deep dot notation paths', () => {
      expect(harvester.queryPath(sampleData, 'meta.page')).toBe(1);
      expect(harvester.queryPath(sampleData, 'data.products.0.name')).toBe('Ergonomic Keyboard');
    });

    it('should query bracket notation array indexing', () => {
      expect(harvester.queryPath(sampleData, 'data.products[1].price')).toBe(59.99);
      expect(harvester.queryPath(sampleData, 'data.products[0].tags[1]')).toBe('ergonomic');
    });

    it('should handle wildcard array queries', () => {
      const names = harvester.queryPath(sampleData, 'data.products.*.name');
      expect(names).toEqual(['Ergonomic Keyboard', 'Vertical Mouse']);
    });

    it('should return undefined gracefully for non-existent paths', () => {
      expect(harvester.queryPath(sampleData, 'data.nonexistent')).toBeUndefined();
      expect(harvester.queryPath(sampleData, 'data.products[99].name')).toBeUndefined();
      expect(harvester.queryPath(null, 'any.path')).toBeUndefined();
    });

    it('should return entire data if path is empty or dot', () => {
      expect(harvester.queryPath(sampleData, '')).toBe(sampleData);
      expect(harvester.queryPath(sampleData, '.')).toBe(sampleData);
      expect(harvester.queryPath(sampleData, undefined)).toBe(sampleData);
    });
  });

  describe('NetworkPayloadHarvester - Fact & Finding Formatting', () => {
    it('should format array of objects into structured facts and findings', () => {
      const items = [
        { title: 'Item A', value: 100 },
        { title: 'Item B', value: 200 },
      ];
      const harvestResult = harvester.harvest(items, {
        url: 'https://api.store.com/v1/items',
        topic: 'Inventory',
        maxItems: 10,
      });

      expect(harvestResult.sourceUrl).toBe('https://api.store.com/v1/items');
      expect(harvestResult.facts.length).toBe(2);
      expect(harvestResult.facts[0]).toContain('[Inventory] [Payload from https://api.store.com/v1/items] Item #1/2:');
      expect(harvestResult.facts[0]).toContain('"title":"Item A"');
      expect(harvestResult.findings.length).toBe(2);
      expect(harvestResult.findings[0].confidence).toBe(0.95);
      expect(harvestResult.findings[0].sourceUrls).toEqual(['https://api.store.com/v1/items']);
    });

    it('should respect maxItems truncation', () => {
      const manyItems = Array.from({ length: 30 }, (_, i) => ({ id: i }));
      const harvestResult = harvester.harvest(manyItems, {
        url: 'https://api.store.com/v1/many',
        maxItems: 5,
      });

      expect(harvestResult.facts.length).toBe(6); // 5 items + 1 truncation note
      expect(harvestResult.facts[5]).toContain('25 additional items omitted');
      // Truncation note should not become a finding
      expect(harvestResult.findings.length).toBe(5);
    });

    it('should format single object key-value pairs', () => {
      const info = { name: 'Alpha', version: '2.0.1' };
      const facts = harvester.formatAsFacts(info, 'https://api.service.io/status');

      expect(facts.length).toBe(2);
      expect(facts.some((f) => f.includes('name: Alpha'))).toBe(true);
      expect(facts.some((f) => f.includes('version: 2.0.1'))).toBe(true);
    });
  });

  describe('NetworkObserver - JSON Payload Caching & Secret Redaction', () => {
    it('should store and retrieve sanitized JSON payload with redacted credentials', async () => {
      const observer = new NetworkObserver();
      const mockPage = {
        on: () => mockPage,
        once: () => mockPage,
      } as unknown as Page;

      observer.attachToPage(mockPage, 'tab_test_01');

      // Emulate intercepting response
      const fakeResponse = {
        url: () => 'https://api.example.com/api/users',
        request: () => ({
          method: () => 'GET',
          resourceType: () => 'fetch',
        }),
        status: () => 200,
        statusText: () => 'OK',
        headers: () => ({ 'content-type': 'application/json; charset=utf-8' }),
        text: async () => JSON.stringify({
          users: [
            { id: 1, name: 'Alice', token: 'Bearer sk-ant-api03-secrettoken1234567890' },
          ],
        }),
      };

      // Call handleResponse
      await (observer as unknown as { handleResponse: (p: Page, r: unknown) => Promise<void> })
        .handleResponse(mockPage, fakeResponse);

      const captured = observer.getCapturedPayloads('tab_test_01');
      expect(captured.length).toBe(1);
      expect(captured[0].url).toBe('https://api.example.com/api/users');
      expect(captured[0].status).toBe(200);

      // Verify secrets redacted
      const payloadData = captured[0].data as { users: Array<{ token: string }> };
      expect(payloadData.users[0].token).toContain('[REDACTED]');

      // Test URL pattern lookup
      const found = observer.findPayloadByUrl('users', 'tab_test_01');
      expect(found).toBeDefined();
      expect(found?.url).toBe('https://api.example.com/api/users');

      const notFound = observer.findPayloadByUrl('nonexistent', 'tab_test_01');
      expect(notFound).toBeUndefined();
    });
  });

  describe('Action Execution - harvest_network_payload', () => {
    it('should validate harvest_network_payload action schema', () => {
      const validAction = {
        type: 'harvest_network_payload',
        urlPattern: '/api/v1/search',
        jsonPath: 'results.items',
        destination: 'both',
        topic: 'ProductCatalog',
      };

      const parsed = ActionValidator.validate(validAction);
      expect(parsed.type).toBe('harvest_network_payload');
    });

    it('should execute harvest_network_payload and inject into Working & Research Memory and SQLite', async () => {
      const observer = new NetworkObserver();
      const mockPage = {
        url: () => 'https://example.com/catalog',
        on: () => mockPage,
        once: () => mockPage,
      } as unknown as Page;

      observer.attachToPage(mockPage, 'tab_harvest_01');

      // Seed captured payload
      const fakeResponse = {
        url: () => 'https://api.example.com/catalog/items',
        request: () => ({
          method: () => 'GET',
          resourceType: () => 'xhr',
        }),
        status: () => 200,
        statusText: () => 'OK',
        headers: () => ({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({
          data: {
            catalog: [
              { id: 'c1', title: 'Laptop Pro', price: 1299 },
              { id: 'c2', title: 'Wireless Keyboard', price: 79 },
            ],
          },
        }),
      };

      await (observer as unknown as { handleResponse: (p: Page, r: unknown) => Promise<void> })
        .handleResponse(mockPage, fakeResponse);

      const memoryManager = new MemoryManager();
      const db = new SqliteDatabase({ path: ':memory:' });
      db.prepare(`
        INSERT INTO tasks (id, goal, status, max_steps, step_count, created_at)
        VALUES ('task_harvest_test_01', 'Test payload harvest', 'running', 10, 0, datetime('now'))
      `).run();
      const researchRepo = new ResearchRepository(db);
      const logger = new Logger({ level: 'error' });

      const mockBrowserManager = {
        runWithLock: async (fn: () => Promise<unknown>) => await fn(),
        getNetworkObserver: () => observer,
      } as unknown as BrowserManager;

      const registry = new ActionRegistry();

      const context: ActionExecutionContext = {
        page: mockPage,
        tabId: 'tab_harvest_01',
        browserManager: mockBrowserManager,
        logger,
        memoryManager,
        researchRepo,
        networkObserver: observer,
        taskId: 'task_harvest_test_01',
      };

      const actionResult = await registry.dispatch(
        {
          id: 'act_harvest_01',
          type: 'harvest_network_payload',
          urlPattern: 'catalog/items',
          jsonPath: 'data.catalog',
          destination: 'both',
          topic: 'CatalogItems',
          maxItems: 10,
        },
        context
      );

      expect(actionResult.success).toBe(true);
      const delta = actionResult.observationDelta as {
        harvestedUrl: string;
        factsCount: number;
        sampleFacts: string[];
      };

      expect(delta.harvestedUrl).toBe('https://api.example.com/catalog/items');
      expect(delta.factsCount).toBe(2);

      // Verify WorkingMemory received facts
      const workingFacts = memoryManager.getWorkingMemory().getFacts();
      expect(workingFacts.length).toBe(2);
      expect(workingFacts[0]).toContain('[CatalogItems]');
      expect(workingFacts[0]).toContain('Laptop Pro');

      // Verify ResearchMemory received sources and findings
      const researchFindings = memoryManager.getResearchMemory().getFindings();
      expect(researchFindings.length).toBe(2);
      expect(researchFindings[0].confidence).toBe(0.95);

      // Verify SQLite ResearchRepository persistence
      const persistedFindings = researchRepo.getFindingsForTask('task_harvest_test_01');
      expect(persistedFindings.length).toBe(2);
      expect(persistedFindings[0].claim).toContain('Laptop Pro');

      const persistedSources = researchRepo.getSourcesForTask('task_harvest_test_01');
      expect(persistedSources.length).toBe(1);
      expect(persistedSources[0].url).toBe('https://api.example.com/catalog/items');
    });

    it('should fail cleanly if requested URL pattern is not present in network cache', async () => {
      const observer = new NetworkObserver();
      const mockPage = { url: () => 'https://example.com' } as unknown as Page;
      const logger = new Logger({ level: 'error' });
      const mockBrowserManager = {
        runWithLock: async (fn: () => Promise<unknown>) => await fn(),
        getNetworkObserver: () => observer,
      } as unknown as BrowserManager;

      const registry = new ActionRegistry();

      const context: ActionExecutionContext = {
        page: mockPage,
        tabId: 'tab_empty',
        browserManager: mockBrowserManager,
        logger,
        networkObserver: observer,
      };

      const actionResult = await registry.dispatch(
        {
          id: 'act_fail_01',
          type: 'harvest_network_payload',
          urlPattern: 'missing-endpoint',
          destination: 'working',
          maxItems: 5,
        },
        context
      );

      expect(actionResult.success).toBe(false);
      expect(actionResult.error?.message).toContain('No captured network payload matched pattern "missing-endpoint"');
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page, Request, Response } from 'playwright-core';
import { NetworkObserver } from '../../src/observer/NetworkObserver.js';
import { ObservationCompressor } from '../../src/observer/ObservationCompressor.js';
import { Evaluator } from '../../src/agent/Evaluator.js';
import type { PageSnapshot } from '../../src/observer/PageSnapshot.js';
import { Logger } from '../../src/logging/Logger.js';

interface MockPageHandlers {
  requestfailed?: (req: Request) => void;
  response?: (res: Response) => void;
  close?: () => void;
}

function createMockPage(): { page: Page; handlers: MockPageHandlers } {
  const handlers: MockPageHandlers = {};
  const page = {
    on: vi.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      if (event === 'requestfailed') handlers.requestfailed = handler as (req: Request) => void;
      if (event === 'response') handlers.response = handler as (res: Response) => void;
    }),
    once: vi.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      if (event === 'close') handlers.close = handler as () => void;
    }),
  } as unknown as Page;

  return { page, handlers };
}

function createMockRequest(options: {
  url: string;
  method?: string;
  resourceType?: string;
  failureText?: string;
}): Request {
  return {
    url: () => options.url,
    method: () => options.method ?? 'GET',
    resourceType: () => options.resourceType ?? 'fetch',
    failure: () => (options.failureText ? { errorText: options.failureText } : null),
  } as unknown as Request;
}

function createMockResponse(options: {
  url: string;
  method?: string;
  resourceType?: string;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  bodyText?: string;
}): Response {
  const req = createMockRequest({
    url: options.url,
    method: options.method ?? 'GET',
    resourceType: options.resourceType ?? 'fetch',
  });

  return {
    url: () => options.url,
    status: () => options.status ?? 200,
    statusText: () => options.statusText ?? (options.status && options.status >= 400 ? 'Error' : 'OK'),
    request: () => req,
    headers: () => options.headers ?? { 'content-type': 'application/json' },
    text: vi.fn().mockResolvedValue(options.bodyText ?? ''),
  } as unknown as Response;
}

describe('Phase 27: Reactive Network & CDP Interception Subsystem', () => {
  let logger: Logger;
  let networkObserver: NetworkObserver;

  beforeEach(() => {
    logger = new Logger('debug', () => {});
    networkObserver = new NetworkObserver({
      maxEventsPerTab: 5,
      maxBodyLength: 100,
      logger,
    });
  });

  describe('NetworkObserver - Event Interception & Filtering', () => {
    it('should ignore static assets and analytics trackers', () => {
      const { page, handlers } = createMockPage();
      networkObserver.attachToPage(page, 'tab_001');

      // Static image request failure
      const imgReq = createMockRequest({
        url: 'https://store.local/assets/logo.png',
        resourceType: 'image',
        failureText: 'net::ERR_ABORTED',
      });
      handlers.requestfailed?.(imgReq);

      // Google Analytics response
      const gaRes = createMockResponse({
        url: 'https://www.google-analytics.com/g/collect?v=2',
        status: 200,
      });
      handlers.response?.(gaRes);

      const summary = networkObserver.getNetworkSummary('tab_001');
      expect(summary.failedRequests).toHaveLength(0);
      expect(summary.recentApiResponses).toHaveLength(0);
    });

    it('should capture failed API requests with redacted secrets', () => {
      const { page, handlers } = createMockPage();
      networkObserver.attachToPage(page, 'tab_001');

      const failedReq = createMockRequest({
        url: 'https://store.local/api/checkout?token=sk-1234567890123456789012',
        method: 'POST',
        resourceType: 'fetch',
        failureText: 'net::ERR_CONNECTION_REFUSED',
      });

      handlers.requestfailed?.(failedReq);

      const summary = networkObserver.getNetworkSummary('tab_001');
      expect(summary.failedRequests).toHaveLength(1);
      expect(summary.failedRequests[0].method).toBe('POST');
      expect(summary.failedRequests[0].errorText).toBe('net::ERR_CONNECTION_REFUSED');
      expect(summary.failedRequests[0].url).toContain('[REDACTED_API_KEY]');
      expect(summary.failedRequests[0].url).not.toContain('sk-1234567890123456789012');
    });

    it('should capture HTTP 4xx/5xx API errors and sanitize response bodies', async () => {
      const { page, handlers } = createMockPage();
      networkObserver.attachToPage(page, 'tab_001');

      const errorRes = createMockResponse({
        url: 'https://store.local/api/cart/submit',
        method: 'POST',
        status: 422,
        statusText: 'Unprocessable Entity',
        headers: { 'content-type': 'application/json' },
        bodyText: JSON.stringify({
          error: 'Out of stock',
          auth_token: 'Bearer sensitive_secret_123',
        }),
      });

      await handlers.response?.(errorRes);

      const summary = networkObserver.getNetworkSummary('tab_001');
      expect(summary.recentApiResponses).toHaveLength(1);
      const entry = summary.recentApiResponses[0];
      expect(entry.status).toBe(422);
      expect(entry.isError).toBe(true);
      expect(entry.bodySummary).toContain('Out of stock');
      expect(entry.bodySummary).toContain('Bearer [REDACTED]');
      expect(entry.bodySummary).not.toContain('sensitive_secret_123');
    });

    it('should enforce sliding window buffer size per tab', async () => {
      const { page, handlers } = createMockPage();
      networkObserver.attachToPage(page, 'tab_001');

      for (let i = 1; i <= 8; i++) {
        const res = createMockResponse({
          url: `https://store.local/api/items/${i}`,
          method: 'GET',
          status: 200,
          resourceType: 'fetch',
          bodyText: JSON.stringify({ item: i }),
        });
        await handlers.response?.(res);
      }

      const summary = networkObserver.getNetworkSummary('tab_001');
      // Buffer limit configured as 5
      expect(summary.recentApiResponses).toHaveLength(5);
      expect(summary.recentApiResponses[0].url).toBe('https://store.local/api/items/4');
      expect(summary.recentApiResponses[4].url).toBe('https://store.local/api/items/8');
    });

    it('should clear buffer when clear is requested', () => {
      const { page, handlers } = createMockPage();
      networkObserver.attachToPage(page, 'tab_001');

      const failedReq = createMockRequest({
        url: 'https://store.local/api/fail',
        failureText: 'net::ERR_FAILED',
      });
      handlers.requestfailed?.(failedReq);

      expect(networkObserver.getNetworkSummary('tab_001').failedRequests).toHaveLength(1);
      networkObserver.clear('tab_001');
      expect(networkObserver.getNetworkSummary('tab_001').failedRequests).toHaveLength(0);
    });
  });

  describe('ObservationCompressor with Network Activity', () => {
    it('should include Recent Network Activity section when network errors exist', () => {
      const compressor = new ObservationCompressor();
      const output = compressor.compress({
        title: 'Checkout Store',
        url: 'https://store.local/checkout',
        elements: [],
        summary: { headings: [], forms: [], links: [] },
        networkSummary: {
          failedRequests: [
            {
              url: 'https://store.local/api/pay',
              method: 'POST',
              resourceType: 'fetch',
              errorText: 'net::ERR_CONNECTION_REFUSED',
              timestamp: '2026-09-07T00:00:00Z',
            },
          ],
          recentApiResponses: [
            {
              url: 'https://store.local/api/coupon',
              method: 'POST',
              status: 400,
              statusText: 'Bad Request',
              isError: true,
              bodySummary: '{"message":"Expired coupon"}',
              timestamp: '2026-09-07T00:00:00Z',
            },
          ],
        },
      });

      expect(output).toContain('Recent Network Activity:');
      expect(output).toContain('[FAILED REQUEST]: POST https://store.local/api/pay (net::ERR_CONNECTION_REFUSED)');
      expect(output).toContain('[API ERROR 400]: POST https://store.local/api/coupon -> {"message":"Expired coupon"}');
    });
  });

  describe('Evaluator Empirical Verification with Network Signals', () => {
    const evaluator = new Evaluator();

    function makeSnapshot(options: {
      url?: string;
      networkSummary?: PageSnapshot['networkSummary'];
    }): PageSnapshot {
      return {
        timestamp: new Date().toISOString(),
        url: options.url ?? 'https://store.local/cart',
        title: 'Shopping Cart',
        activeTabId: 'tab_001',
        interactiveElements: [],
        pageSummary: { headings: [], forms: [], links: [] },
        compressedObservationText: '[Page: "Shopping Cart"]',
        networkSummary: options.networkSummary,
      };
    }

    it('should immediately fail step evaluation when a backend API error occurs', () => {
      const prevSnap = makeSnapshot({
        networkSummary: { failedRequests: [], recentApiResponses: [] },
      });

      const currSnap = makeSnapshot({
        networkSummary: {
          failedRequests: [],
          recentApiResponses: [
            {
              url: 'https://store.local/api/checkout',
              method: 'POST',
              status: 500,
              statusText: 'Internal Server Error',
              isError: true,
              bodySummary: '{"error":"Payment gateway down"}',
              timestamp: '2026-09-07T00:00:01Z',
            },
          ],
        },
      });

      const result = evaluator.evaluate(prevSnap, currSnap, 'Order confirmed');
      expect(result.status).toBe('failure');
      expect(result.reason).toContain('Backend API error [HTTP 500]');
      expect(result.reason).toContain('Payment gateway down');
    });

    it('should immediately fail step evaluation when a network dropout occurs', () => {
      const prevSnap = makeSnapshot({
        networkSummary: { failedRequests: [], recentApiResponses: [] },
      });

      const currSnap = makeSnapshot({
        networkSummary: {
          failedRequests: [
            {
              url: 'https://store.local/api/save',
              method: 'POST',
              resourceType: 'fetch',
              errorText: 'net::ERR_NAME_NOT_RESOLVED',
              timestamp: '2026-09-07T00:00:02Z',
            },
          ],
          recentApiResponses: [],
        },
      });

      const result = evaluator.evaluate(prevSnap, currSnap, 'Form saved');
      expect(result.status).toBe('failure');
      expect(result.reason).toContain('Network request failed: [POST] https://store.local/api/save (net::ERR_NAME_NOT_RESOLVED)');
    });

    it('should not fail if expected outcome explicitly expected an error', () => {
      const prevSnap = makeSnapshot({
        networkSummary: { failedRequests: [], recentApiResponses: [] },
      });

      const currSnap = makeSnapshot({
        networkSummary: {
          failedRequests: [],
          recentApiResponses: [
            {
              url: 'https://store.local/api/login',
              method: 'POST',
              status: 401,
              statusText: 'Unauthorized',
              isError: true,
              bodySummary: '{"error":"Invalid credentials"}',
              timestamp: '2026-09-07T00:00:03Z',
            },
          ],
        },
      });

      // Expecting failure / error
      const result = evaluator.evaluate(prevSnap, currSnap, 'Should see invalid credentials error');
      // Status shouldn't be forced to failure by the network error check
      expect(result.status).not.toBe('failure');
    });

    it('should ignore old network errors that already existed in previousSnapshot', () => {
      const oldError = {
        url: 'https://store.local/api/old',
        method: 'GET',
        status: 404,
        statusText: 'Not Found',
        isError: true,
        bodySummary: 'Old error',
        timestamp: '2026-09-07T00:00:00Z',
      };

      const prevSnap = makeSnapshot({
        networkSummary: {
          failedRequests: [],
          recentApiResponses: [oldError],
        },
      });

      // Same error in current snapshot, no new error
      const currSnap = makeSnapshot({
        networkSummary: {
          failedRequests: [],
          recentApiResponses: [oldError],
        },
      });

      const result = evaluator.evaluate(prevSnap, currSnap, undefined);
      // No new network error detected
      expect(result.reason).not.toContain('Backend API error');
    });
  });
});

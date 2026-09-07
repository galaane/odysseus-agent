import type { Page, Request, Response } from 'playwright-core';
import type { Logger } from '../logging/Logger.js';
import { redactSecrets } from '../logging/Logger.js';

export interface NetworkFailedRequest {
  url: string;
  method: string;
  resourceType: string;
  errorText: string;
  timestamp: string;
}

export interface NetworkApiResponse {
  url: string;
  method: string;
  status: number;
  statusText: string;
  isError: boolean;
  bodySummary?: string;
  timestamp: string;
}

export interface NetworkSummary {
  failedRequests: NetworkFailedRequest[];
  recentApiResponses: NetworkApiResponse[];
}

export interface CapturedPayloadRecord {
  url: string;
  method: string;
  status: number;
  data: unknown;
  rawSize: number;
  timestamp: string;
}

export interface NetworkObserverOptions {
  maxEventsPerTab?: number;
  maxBodyLength?: number;
  logger?: Logger;
}

const IGNORED_RESOURCE_TYPES = new Set(['image', 'media', 'font', 'stylesheet', 'manifest', 'texttrack']);
const STATIC_ASSET_EXT_REGEX = /\.(png|jpe?g|gif|svg|ico|webp|avif|css|woff2?|ttf|eot)(\?.*)?$/i;
const TRACKER_DOMAINS_REGEX = /(google-analytics\.com|googletagmanager\.com|analytics\.google\.com|doubleclick\.net|segment\.io|hotjar\.com|sentry\.io)/i;

export class NetworkObserver {
  private readonly maxEventsPerTab: number;
  private readonly maxBodyLength: number;
  private readonly logger?: Logger;

  private attachedPages = new WeakSet<Page>();
  private pageToTabId = new WeakMap<Page, string>();
  private tabNetworkData = new Map<string, {
    failedRequests: NetworkFailedRequest[];
    recentApiResponses: NetworkApiResponse[];
    capturedPayloads: CapturedPayloadRecord[];
  }>();

  // Default global buffer for when no tabId is available
  private defaultBuffer: {
    failedRequests: NetworkFailedRequest[];
    recentApiResponses: NetworkApiResponse[];
    capturedPayloads: CapturedPayloadRecord[];
  } = {
    failedRequests: [],
    recentApiResponses: [],
    capturedPayloads: [],
  };

  constructor(options?: NetworkObserverOptions) {
    this.maxEventsPerTab = options?.maxEventsPerTab ?? 15;
    this.maxBodyLength = options?.maxBodyLength ?? 300;
    this.logger = options?.logger;
  }

  /**
   * Attaches network listeners to a Playwright page instance if not already attached.
   */
  public attachToPage(page: Page, tabId?: string): void {
    if (!page || typeof page.on !== 'function') return;

    if (tabId) {
      this.pageToTabId.set(page, tabId);
      if (!this.tabNetworkData.has(tabId)) {
        this.tabNetworkData.set(tabId, {
          failedRequests: [],
          recentApiResponses: [],
          capturedPayloads: [],
        });
      }
    }

    if (this.attachedPages.has(page)) {
      return;
    }
    this.attachedPages.add(page);

    // 1. Intercept network request dropouts and aborts
    page.on('requestfailed', (request: Request) => {
      this.handleRequestFailed(page, request);
    });

    // 2. Intercept API responses (XHR, Fetch, GraphQL, and HTTP 4xx/5xx)
    page.on('response', (response: Response) => {
      this.handleResponse(page, response).catch((err: unknown) => {
        this.logger?.debug('NetworkObserver', `Error reading response: ${String(err)}`);
      });
    });

    // Clean up when page closes
    if (typeof page.once === 'function') {
      page.once('close', () => {
        this.attachedPages.delete(page);
      });
    }
  }

  /**
   * Retrieves the current network summary for a specific page or tabId.
   */
  public getNetworkSummary(pageOrTabId?: Page | string): NetworkSummary {
    const buffer = this.getBuffer(pageOrTabId);
    return {
      failedRequests: [...buffer.failedRequests],
      recentApiResponses: [...buffer.recentApiResponses],
    };
  }

  public getFailedRequests(pageOrTabId?: Page | string): NetworkFailedRequest[] {
    return [...this.getBuffer(pageOrTabId).failedRequests];
  }

  public getRecentApiResponses(pageOrTabId?: Page | string): NetworkApiResponse[] {
    return [...this.getBuffer(pageOrTabId).recentApiResponses];
  }

  /**
   * Returns captured raw JSON payloads.
   */
  public getCapturedPayloads(pageOrTabId?: Page | string): CapturedPayloadRecord[] {
    return [...this.getBuffer(pageOrTabId).capturedPayloads];
  }

  /**
   * Finds the latest captured JSON payload matching a URL substring or regex pattern.
   */
  public findPayloadByUrl(urlPattern: string, pageOrTabId?: Page | string): CapturedPayloadRecord | undefined {
    const payloads = this.getBuffer(pageOrTabId).capturedPayloads;
    const lower = urlPattern.toLowerCase();
    for (let i = payloads.length - 1; i >= 0; i--) {
      if (payloads[i].url.toLowerCase().includes(lower)) {
        return payloads[i];
      }
    }
    return undefined;
  }

  /**
   * Clears buffered network events.
   */
  public clear(pageOrTabId?: Page | string): void {
    if (pageOrTabId) {
      const buffer = this.getBuffer(pageOrTabId);
      buffer.failedRequests = [];
      buffer.recentApiResponses = [];
      buffer.capturedPayloads = [];
    } else {
      this.defaultBuffer.failedRequests = [];
      this.defaultBuffer.recentApiResponses = [];
      this.defaultBuffer.capturedPayloads = [];
      this.tabNetworkData.clear();
    }
  }

  private handleRequestFailed(page: Page, request: Request): void {
    const url = request.url();
    const resourceType = request.resourceType();

    // Filter out static assets and noise
    if (this.isIgnored(url, resourceType)) {
      return;
    }

    const failure = request.failure();
    const errorText = failure?.errorText || 'Unknown network failure';
    const method = request.method();

    const sanitizedUrl = redactSecrets(url) as string;
    const sanitizedError = redactSecrets(errorText) as string;

    const failedItem: NetworkFailedRequest = {
      url: sanitizedUrl,
      method,
      resourceType,
      errorText: sanitizedError,
      timestamp: new Date().toISOString(),
    };

    const buffer = this.getBuffer(page);
    buffer.failedRequests.push(failedItem);
    if (buffer.failedRequests.length > this.maxEventsPerTab) {
      buffer.failedRequests.shift();
    }

    this.logger?.debug('NetworkObserver', `Captured failed request: [${method}] ${sanitizedUrl} - ${sanitizedError}`);
  }

  private async handleResponse(page: Page, response: Response): Promise<void> {
    const url = response.url();
    const request = response.request();
    const resourceType = request.resourceType();
    const status = response.status();
    const isError = status >= 400;

    // Filter out static assets
    if (this.isIgnored(url, resourceType)) {
      return;
    }

    // Only capture XHR/Fetch, GraphQL, API endpoints, or any error response
    const isApiRequest =
      resourceType === 'xhr' ||
      resourceType === 'fetch' ||
      url.includes('/api/') ||
      url.includes('/graphql');

    if (!isApiRequest && !isError) {
      return;
    }

    let bodySummary: string | undefined;
    const buffer = this.getBuffer(page);
    const sanitizedUrl = redactSecrets(url) as string;

    try {
      const headers = response.headers();
      const contentType = (headers['content-type'] || '').toLowerCase();

      if (
        contentType.includes('json') ||
        contentType.includes('text/plain') ||
        contentType.includes('problem+json')
      ) {
        const text = await response.text();
        if (text) {
          const sanitized = redactSecrets(text) as string;
          bodySummary = sanitized.length > this.maxBodyLength
            ? `${sanitized.slice(0, this.maxBodyLength)}... [truncated]`
            : sanitized;

          if (contentType.includes('json') || contentType.includes('problem+json')) {
            try {
              const parsed = JSON.parse(text);
              const sanitizedData = redactSecrets(parsed);
              const payloadRecord: CapturedPayloadRecord = {
                url: sanitizedUrl,
                method: request.method(),
                status,
                data: sanitizedData,
                rawSize: text.length,
                timestamp: new Date().toISOString(),
              };
              buffer.capturedPayloads.push(payloadRecord);
              if (buffer.capturedPayloads.length > this.maxEventsPerTab) {
                buffer.capturedPayloads.shift();
              }
            } catch {
              // Ignore non-parseable JSON
            }
          }
        }
      }
    } catch {
      // Body reading may fail for redirected or aborted streams; this is expected
    }

    const apiItem: NetworkApiResponse = {
      url: sanitizedUrl,
      method: request.method(),
      status,
      statusText: response.statusText(),
      isError,
      bodySummary,
      timestamp: new Date().toISOString(),
    };

    buffer.recentApiResponses.push(apiItem);
    if (buffer.recentApiResponses.length > this.maxEventsPerTab) {
      buffer.recentApiResponses.shift();
    }

    if (isError) {
      this.logger?.warn('NetworkObserver', `Detected API error response [${status}]: [${apiItem.method}] ${sanitizedUrl}`, {
        status,
        bodySummary,
      });
    }
  }

  private isIgnored(url: string, resourceType: string): boolean {
    if (IGNORED_RESOURCE_TYPES.has(resourceType)) {
      return true;
    }
    if (STATIC_ASSET_EXT_REGEX.test(url)) {
      return true;
    }
    if (TRACKER_DOMAINS_REGEX.test(url)) {
      return true;
    }
    return false;
  }

  private getBuffer(pageOrTabId?: Page | string): {
    failedRequests: NetworkFailedRequest[];
    recentApiResponses: NetworkApiResponse[];
    capturedPayloads: CapturedPayloadRecord[];
  } {
    if (typeof pageOrTabId === 'string') {
      let buffer = this.tabNetworkData.get(pageOrTabId);
      if (!buffer) {
        buffer = { failedRequests: [], recentApiResponses: [], capturedPayloads: [] };
        this.tabNetworkData.set(pageOrTabId, buffer);
      }
      return buffer;
    }

    if (pageOrTabId && typeof pageOrTabId === 'object') {
      const tabId = this.pageToTabId.get(pageOrTabId);
      if (tabId) {
        return this.getBuffer(tabId);
      }
    }

    return this.defaultBuffer;
  }
}

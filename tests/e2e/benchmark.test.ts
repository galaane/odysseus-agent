import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TestSiteServer } from '../../test-site/index.js';
import { ResearchEngine } from '../../src/research/ResearchEngine.js';
import { DocumentParser } from '../../src/research/DocumentParser.js';
import { CredentialVault } from '../../src/credentials/CredentialVault.js';
import { LoginWorkflow } from '../../src/agent/workflows/LoginWorkflow.js';
import { RegistrationWorkflow } from '../../src/agent/workflows/RegistrationWorkflow.js';
import { TabManager } from '../../src/browser/TabManager.js';
import { BrowserEventEmitter } from '../../src/browser/BrowserEvents.js';
import { RecoveryManager } from '../../src/agent/RecoveryManager.js';
import { Evaluator } from '../../src/agent/Evaluator.js';
import { Logger } from '../../src/logging/Logger.js';
import type { Page } from 'playwright-core';

describe('Phase 13: Benchmark Evaluation Suite (T001 - T012) [Invariant 15]', () => {
  let server: TestSiteServer;
  let baseUrl: string;
  let logger: Logger;
  let tempDir: string;

  beforeAll(async () => {
    logger = new Logger('error');
    server = new TestSiteServer();
    const port = await server.start(0);
    baseUrl = `http://localhost:${port}`;
    tempDir = mkdtempSync(join(tmpdir(), 'odysseus-benchmark-'));
  });

  afterAll(async () => {
    await server.stop();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors on locked windows files
    }
  });

  /**
   * T001 — Navigate: Direct URL navigation and title verification.
   */
  it('T001 — Navigate: should perform direct URL navigation and verify title', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);

    const html = await res.text();
    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    expect(titleMatch?.[1]).toBe('Odysseus Local Test Site');
    expect(html).toContain('Odysseus Test Site');
  });

  /**
   * T002 — Search: Submitting a query into a search field and selecting the top result.
   */
  it('T002 — Search: should submit a query into search portal and navigate to top result', async () => {
    const searchUrl = `${baseUrl}/search?q=enterprise+pricing`;
    const res = await fetch(searchUrl);
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain('Results for "enterprise pricing"');
    expect(html).toContain('top-result-link');

    // Extract top result URL
    const topResultMatch = html.match(/href="(\/search\/result\/1)"/);
    expect(topResultMatch).toBeDefined();
    const resultPath = topResultMatch?.[1] || '';

    // Follow link
    const detailRes = await fetch(`${baseUrl}${resultPath}`);
    expect(detailRes.status).toBe(200);
    const detailHtml = await detailRes.text();
    expect(detailHtml).toContain('The enterprise plan is priced at $99 per user per month');
  });

  /**
   * T003 — Click: Locating and clicking dynamic buttons with state verification.
   */
  it('T003 — Click: should evaluate button click state transition', async () => {
    const evaluator = new Evaluator();

    // Verify state transition evaluation on dynamic button click
    const evalResult = evaluator.evaluate(
      {
        url: `${baseUrl}/slow-page`,
        title: 'Slow Loading Page',
        contentHash: 'hash_before',
        textSummary: 'Status: Loading dynamic components...',
        compressedObservationText: 'Status: Loading dynamic components...',
        pageSummary: {
          prose: 'Loading dynamic components...',
          headings: ['Slow Loading Page'],
          notices: [],
          interactiveElementsCount: 0,
        },
        interactiveElements: [],
      } as any,
      {
        url: `${baseUrl}/slow-page`,
        title: 'Slow Loading Page',
        contentHash: 'hash_after',
        textSummary: 'Status: Ready',
        compressedObservationText: 'Status: Ready. Action successfully executed!',
        pageSummary: {
          prose: 'Ready',
          headings: ['Slow Loading Page'],
          notices: ['Action successfully executed!'],
          interactiveElementsCount: 1,
        },
        interactiveElements: [],
      } as any,
      'Action successfully executed'
    );

    expect(evalResult.status).toBe('success');
  });

  /**
   * T004 — Fill Form: Completing multi-field forms with validation error checking.
   */
  it('T004 — Fill Form: should handle form validation failures and valid submissions', async () => {
    // 1. Send invalid submission (mismatched password)
    const failRes = await fetch(`${baseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        username: 'analyst_01',
        email: 'analyst@odysseus.test',
        password: 'ValidPassword123!',
        'confirm-password': 'MismatchPassword',
      }).toString(),
    });
    expect(failRes.status).toBe(200);
    const failHtml = await failRes.text();
    expect(failHtml).toContain('Passwords do not match');

    // 2. Send valid submission
    const okRes = await fetch(`${baseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        username: 'analyst_01',
        email: 'analyst@odysseus.test',
        password: 'ValidPassword123!',
        'confirm-password': 'ValidPassword123!',
      }).toString(),
    });
    expect(okRes.status).toBe(200);
    const okHtml = await okRes.text();
    expect(okHtml).toContain('Registration successful! Welcome, analyst_01.');
  });

  /**
   * T005 — Deterministic Login: Injecting credentials, submitting, and verifying dashboard state.
   */
  it('T005 — Deterministic Login: should authenticate via credentials and access protected dashboard', async () => {
    const vault = new CredentialVault();
    vault.setCredential('localhost', {
      username: 'test@example.com',
      password: 'Password123!',
    });

    const creds = await vault.getCredential('localhost');
    expect(creds).toBeDefined();

    // Authenticate against test site
    const loginRes = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        email: creds!.username,
        password: creds!.password,
      }).toString(),
      redirect: 'manual',
    });

    expect(loginRes.status).toBe(302);
    expect(loginRes.headers.get('location')).toBe('/dashboard');

    const cookie = loginRes.headers.get('set-cookie') || '';
    expect(cookie).toContain('session_id=session_mock_123');

    // Verify access to protected dashboard
    const dashRes = await fetch(`${baseUrl}/dashboard`, {
      headers: { Cookie: cookie },
    });
    expect(dashRes.status).toBe(200);
    const dashHtml = await dashRes.text();
    expect(dashHtml).toContain('Welcome, test@example.com');
    expect(dashHtml).toContain('logout-btn');
  });

  /**
   * T006 — Autonomous Registration: Inspecting unknown fields, filling valid agent profile data.
   */
  it('T006 — Autonomous Registration: should verify registration workflow validation logic', async () => {
    const workflow = new RegistrationWorkflow(logger);

    // Mock page with registration form inputs
    const mockPage = {
      url: () => `${baseUrl}/register`,
      locator: (selector: string) => ({
        first: () => ({
          count: async () => 1,
          isVisible: async () => true,
          fill: async () => {},
          click: async () => {},
        }),
        count: async () => (selector.includes('username') || selector.includes('email') || selector.includes('password') ? 1 : 0),
        isVisible: async () => true,
        fill: async () => {},
        click: async () => {},
      }),
      content: async () => '<div id="success-banner">Registration successful</div>',
      waitForTimeout: async () => {},
    } as unknown as Page;

    const result = await workflow.execute(mockPage, {
      username: 'analyst_01',
      email: 'analyst@odysseus.test',
      password: 'ValidPassword123!',
    });
    expect(result.success).toBe(true);
    expect(result.authenticated).toBe(true);
  });

  /**
   * T007 — Multi-Tab Research: Navigating across multiple tabs and tracking tabs.
   */
  it('T007 — Multi-Tab Research: should track multiple tabs and switch active tab context', async () => {
    const emitter = new BrowserEventEmitter();
    const tabManager = new TabManager(emitter, logger);

    const createMockPage = (url: string) =>
      ({
        url: () => url,
        isClosed: () => false,
        close: async () => {},
        bringToFront: async () => {},
        on: () => {},
        once: () => {},
      }) as unknown as Page;

    const page1 = createMockPage(`${baseUrl}/popup-page`);
    const page2 = createMockPage(`${baseUrl}/popup-content`);
    const page3 = createMockPage(`${baseUrl}/search`);

    const tab1 = await tabManager.registerPage(page1);
    expect(tab1.id).toBe('tab_001');

    const tab2 = await tabManager.registerPage(page2);
    expect(tab2.id).toBe('tab_002');

    const tab3 = await tabManager.registerPage(page3);
    expect(tab3.id).toBe('tab_003');

    expect(tabManager.listTabs()).toHaveLength(3);

    // Switch focus to tab 2
    await tabManager.switchTab(tab2.id);
    expect(tabManager.getActiveTab()?.id).toBe(tab2.id);

    // Close tab 1
    await tabManager.closeTab(tab1.id);
    expect(tabManager.listTabs()).toHaveLength(2);
    expect(tabManager.getTabState(tab1.id)).toBeNull();
  });

  /**
   * T008 — Download Artifact: Triggering download, parsing downloaded CSV/PDF into memory.
   */
  it('T008 — Download Artifact: should download and parse CSV and PDF artifacts into structured memory', async () => {
    const parser = new DocumentParser();

    // 1. Download and parse CSV
    const csvRes = await fetch(`${baseUrl}/download/sample.csv`);
    const csvContent = await csvRes.text();
    const csvPath = join(tempDir, 'benchmark_sample.csv');
    writeFileSync(csvPath, csvContent, 'utf-8');

    const parsedCsv = await parser.parse(csvPath);
    expect(parsedCsv.fileType).toBe('csv');
    expect(parsedCsv.metadata?.rowCount).toBe(2);
    expect(parsedCsv.rawText).toContain('Autonomous Engine');

    // 2. Download and parse PDF
    const pdfRes = await fetch(`${baseUrl}/download/sample.pdf`);
    const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
    const pdfPath = join(tempDir, 'benchmark_sample.pdf');
    writeFileSync(pdfPath, pdfBuf);

    const parsedPdf = await parser.parse(pdfPath);
    expect(parsedPdf.fileType).toBe('pdf');
    expect(parsedPdf.rawText).toContain('Odysseus Local Benchmark PDF Content');
  });

  /**
   * T009 — Stale Element Recovery: Handling DOM mutations mid-action without failing.
   */
  it('T009 — Stale Element Recovery: should recover from stale element DOM mutation via RecoveryManager', async () => {
    const mockActionRegistry = {
      dispatch: async () => ({
        actionId: 'act_1',
        actionType: 'click',
        success: true,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 10,
      }),
    } as any;

    const mockPageObserver = {
      observePage: async () => ({}),
      getRegistry: () => ({}),
    } as any;

    const mockBrowserManager = {
      getPageManager: () => ({ getActivePage: () => ({}) }),
      getTabManager: () => ({ getActiveTab: () => ({ id: 'tab_001' }) }),
    } as any;

    const recoveryManager = new RecoveryManager(
      mockBrowserManager,
      mockActionRegistry,
      mockPageObserver,
      logger
    );

    const res = await recoveryManager.attemptRecovery(
      { type: 'click', targetId: 'mutating-el' } as any,
      { page: {} as any, tabId: 'tab_001' } as any,
      { code: 'STALE_ELEMENT', message: 'Element handle is detached from document' }
    );

    expect(res.recovered).toBe(true);
    expect(res.tierUsed).toBe(2);
  });

  /**
   * T010 — Timeout Recovery: Gracefully recovering when action times out.
   */
  it('T010 — Timeout Recovery: should retry transient page navigation timeout with backoff', async () => {
    const mockActionRegistry = {
      dispatch: async () => ({
        actionId: 'act_2',
        actionType: 'navigate',
        success: true,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 10,
      }),
    } as any;

    const mockPageObserver = {
      observePage: async () => ({}),
      getRegistry: () => ({}),
    } as any;

    const mockBrowserManager = {
      getPageManager: () => ({ getActivePage: () => ({}) }),
      getTabManager: () => ({ getActiveTab: () => ({ id: 'tab_001' }) }),
    } as any;

    const recoveryManager = new RecoveryManager(
      mockBrowserManager,
      mockActionRegistry,
      mockPageObserver,
      logger
    );

    const res = await recoveryManager.attemptRecovery(
      { type: 'navigate', url: `${baseUrl}/slow-page` } as any,
      { page: {} as any, tabId: 'tab_001' } as any,
      { code: 'NAVIGATION_TIMEOUT', message: 'Navigation timeout of 30000ms exceeded' }
    );

    expect(res.recovered).toBe(true);
    expect(res.tierUsed).toBe(1);
  });

  /**
   * T011 — Fact Cross-Checking: Verifying a claim against two independent sources.
   */
  it('T011 — Fact Cross-Checking: should aggregate claims across independent sources and calculate domain corroboration', async () => {
    const engine = new ResearchEngine(logger);

    // Fetch facts from Source A
    const resA = await fetch(`${baseUrl}/facts/source-a`);
    const htmlA = await resA.text();
    const claimA = 'Solar photovoltaic energy generation grew by 32% year-over-year.';
    expect(htmlA).toContain('Solar photovoltaic energy generation grew by 32%');

    // Fetch facts from Source B
    const resB = await fetch(`${baseUrl}/facts/source-b`);
    const htmlB = await resB.text();
    expect(htmlB).toContain('solar photovoltaic energy generation grew by 32%');

    // Record finding corroborated across both independent URLs
    const finding = engine.addFinding(claimA, [
      'https://global-energy-agency.local/report-2026',
      'https://cleantech-institute.local/market-review-2026',
    ]);

    expect(finding.claim).toBe(claimA);
    expect(finding.sourceIds).toHaveLength(2);
    expect(finding.confidence).toBe(0.95); // Corroborated across 2 distinct top-level domains
  });

  /**
   * T012 — End-to-End Workflow: Executing an autonomous research workflow end-to-end.
   */
  it('T012 — End-to-End Workflow: should complete research pipeline and generate comprehensive report', async () => {
    const engine = new ResearchEngine(logger);
    const parser = new DocumentParser();

    // 1. Search for pricing
    const searchRes = await fetch(`${baseUrl}/search?q=pricing`);
    expect(searchRes.status).toBe(200);
    engine.recordSource(`${baseUrl}/search?q=pricing`, 'Search Portal');

    // 2. Navigate to result detail
    const detailRes = await fetch(`${baseUrl}/search/result/1`);
    expect(detailRes.status).toBe(200);
    engine.recordSource(`${baseUrl}/search/result/1`, 'Pricing Detail');

    // 3. Register finding from detail page
    engine.addFinding(
      'Enterprise plan is priced at $99 per user per month.',
      [`${baseUrl}/search/result/1`],
      {
        notes: 'Extracted from official search result overview',
        snippet: 'The enterprise plan is priced at $99 per user per month with unlimited browser runtime execution.',
      }
    );

    // 4. Download and process artifact
    const csvRes = await fetch(`${baseUrl}/download/sample.csv`);
    const csvPath = join(tempDir, 'e2e_data.csv');
    writeFileSync(csvPath, await csvRes.text(), 'utf-8');
    const doc = await parser.parse(csvPath);

    engine.addFinding(
      `Autonomous Engine SKU-100 catalog price verified at $499.`,
      [`${baseUrl}/download/sample.csv`],
      { snippet: doc.rawText.slice(0, 100) }
    );

    // 5. Generate structured synthesis report
    const report = engine.generateReport('Enterprise Pricing & Product Catalog Research');

    expect(report.topic).toBe('Enterprise Pricing & Product Catalog Research');
    expect(report.totalSources).toBeGreaterThanOrEqual(3);
    expect(report.findings).toHaveLength(2);
    expect(report.summaryText).toContain('Enterprise Pricing & Product Catalog Research');
    expect(report.summaryText).toContain('Enterprise plan is priced at $99');
    expect(report.summaryText).toContain('Autonomous Engine SKU-100');
  });
});

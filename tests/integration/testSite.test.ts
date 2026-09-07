import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestSiteServer } from '../../test-site/index.js';

describe('Phase 13: Local Test Site Server Routes (Invariant 15)', () => {
  let server: TestSiteServer;
  let baseUrl: string;

  beforeAll(async () => {
    server = new TestSiteServer();
    const port = await server.start(0);
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    await server.stop();
  });

  it('should serve navigation hub at GET /', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Odysseus Test Site');
    expect(html).toContain('link-login');
    expect(html).toContain('link-search');
  });

  it('should serve login page and validate bad credentials', async () => {
    const getRes = await fetch(`${baseUrl}/login`);
    expect(getRes.status).toBe(200);
    expect(await getRes.text()).toContain('Member Login');

    const failRes = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: 'bad@test.com', password: 'wrong' }).toString(),
    });
    expect(failRes.status).toBe(200);
    expect(await failRes.text()).toContain('Invalid email or password');
  });

  it('should authenticate valid credentials and issue session cookie', async () => {
    const successRes = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: 'test@example.com', password: 'Password123!' }).toString(),
      redirect: 'manual',
    });

    expect(successRes.status).toBe(302);
    expect(successRes.headers.get('location')).toBe('/dashboard');
    expect(successRes.headers.get('set-cookie')).toContain('session_id=session_mock_123');
  });

  it('should protect /dashboard and require authentication cookie', async () => {
    const unauthRes = await fetch(`${baseUrl}/dashboard`, { redirect: 'manual' });
    expect(unauthRes.status).toBe(302);
    expect(unauthRes.headers.get('location')).toBe('/login');

    const authRes = await fetch(`${baseUrl}/dashboard`, {
      headers: { Cookie: 'session_id=session_mock_123' },
    });
    expect(authRes.status).toBe(200);
    const html = await authRes.text();
    expect(html).toContain('Welcome, test@example.com');
    expect(html).toContain('Enterprise Member');
    expect(html).toContain('logout-btn');
  });

  it('should clear session on /logout', async () => {
    const res = await fetch(`${baseUrl}/logout`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('set-cookie')).toContain('session_id=;');
  });

  it('should handle registration with password confirmation', async () => {
    const mismatchRes = await fetch(`${baseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        username: 'newUser',
        email: 'new@example.com',
        password: 'Pass1',
        'confirm-password': 'Pass2',
      }).toString(),
    });
    expect(mismatchRes.status).toBe(200);
    expect(await mismatchRes.text()).toContain('Passwords do not match');

    const okRes = await fetch(`${baseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        username: 'agentUser',
        email: 'agent@odysseus.local',
        password: 'Secret123!',
        'confirm-password': 'Secret123!',
      }).toString(),
    });
    expect(okRes.status).toBe(200);
    expect(await okRes.text()).toContain('Registration successful');
  });

  it('should process search queries and render results', async () => {
    const res = await fetch(`${baseUrl}/search?q=pricing`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Results for');
    expect(html).toContain('top-result-link');

    const detailRes = await fetch(`${baseUrl}/search/result/1`);
    expect(detailRes.status).toBe(200);
    expect(await detailRes.text()).toContain('Pricing and Tier Overview');
  });

  it('should serve slow-page, broken-page, popup-page, and iframe-page', async () => {
    const slow = await fetch(`${baseUrl}/slow-page`);
    expect(slow.status).toBe(200);
    expect(await slow.text()).toContain('delayed-btn');

    const broken = await fetch(`${baseUrl}/broken-page`);
    expect(broken.status).toBe(200);
    expect(await broken.text()).toContain('mutating-el');

    const popup = await fetch(`${baseUrl}/popup-page`);
    expect(popup.status).toBe(200);
    expect(await popup.text()).toContain('popup-link');

    const popupContent = await fetch(`${baseUrl}/popup-content`);
    expect(popupContent.status).toBe(200);
    expect(await popupContent.text()).toContain('New Tab Content Loaded');

    const iframe = await fetch(`${baseUrl}/iframe-page`);
    expect(iframe.status).toBe(200);
    expect(await iframe.text()).toContain('sub-frame');

    const iframeContent = await fetch(`${baseUrl}/iframe-content`);
    expect(iframeContent.status).toBe(200);
    expect(await iframeContent.text()).toContain('subframe-input');
  });

  it('should serve valid CSV and PDF artifact downloads', async () => {
    const csvRes = await fetch(`${baseUrl}/download/sample.csv`);
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers.get('content-type')).toContain('text/csv');
    const csvText = await csvRes.text();
    expect(csvText).toContain('SKU,Product,Price,Category');
    expect(csvText).toContain('Autonomous Engine');

    const pdfRes = await fetch(`${baseUrl}/download/sample.pdf`);
    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers.get('content-type')).toContain('application/pdf');
    const pdfBuf = await pdfRes.arrayBuffer();
    expect(pdfBuf.byteLength).toBeGreaterThan(100);
    const pdfHeader = Buffer.from(pdfBuf.slice(0, 8)).toString('ascii');
    expect(pdfHeader).toContain('%PDF-1.4');
  });

  it('should serve dynamic SPA and facts sources', async () => {
    const spa = await fetch(`${baseUrl}/dynamic-page`);
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain('spa-view');

    const factA = await fetch(`${baseUrl}/facts/source-a`);
    expect(factA.status).toBe(200);
    expect(await factA.text()).toContain('Solar photovoltaic energy generation grew by 32%');

    const factB = await fetch(`${baseUrl}/facts/source-b`);
    expect(factB.status).toBe(200);
    expect(await factB.text()).toContain('solar photovoltaic energy generation grew by 32%');
  });

  it('should return 404 for unknown route', async () => {
    const res = await fetch(`${baseUrl}/unknown_endpoint_test`);
    expect(res.status).toBe(404);
  });
});

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { deflateSync } from 'node:zlib';

export interface TestSiteServerOptions {
  port?: number;
}

export class TestSiteServer {
  private server: Server | null = null;
  private port: number;

  constructor(options?: TestSiteServerOptions) {
    this.port = options?.port ?? 8080;
  }

  public async start(port?: number): Promise<number> {
    const targetPort = port !== undefined ? port : this.port;

    return new Promise((resolve, reject) => {
      const srv = createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end(`Test site internal error: ${String(err)}`);
        });
      });

      srv.on('error', reject);

      srv.listen(targetPort, () => {
        const addr = srv.address();
        const actualPort = typeof addr === 'object' && addr !== null ? addr.port : targetPort;
        this.port = actualPort;
        this.server = srv;
        resolve(actualPort);
      });
    });
  }

  public async stop(): Promise<void> {
    if (!this.server) return;

    return new Promise((resolve) => {
      this.server?.close(() => {
        this.server = null;
        resolve();
      });
    });
  }

  public getPort(): number {
    return this.port;
  }

  public getBaseUrl(): string {
    return `http://localhost:${this.port}`;
  }

  private async parseBody(req: IncomingMessage): Promise<Record<string, string>> {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    await new Promise<void>((resolve) => req.on('end', resolve));

    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('application/json')) {
      try {
        return JSON.parse(data || '{}');
      } catch {
        return {};
      }
    }

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams(data);
      const result: Record<string, string> = {};
      for (const [k, v] of params.entries()) {
        result[k] = v;
      }
      return result;
    }

    return {};
  }

  private parseCookies(req: IncomingMessage): Record<string, string> {
    const cookieHeader = req.headers['cookie'] || '';
    const cookies: Record<string, string> = {};
    for (const pair of cookieHeader.split(';')) {
      const parts = pair.split('=');
      const key = parts[0]?.trim();
      const val = parts[1]?.trim();
      if (key) cookies[key] = val || '';
    }
    return cookies;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parsedUrl = new URL(req.url || '/', `http://localhost:${this.port}`);
    const pathname = parsedUrl.pathname;
    const method = (req.method || 'GET').toUpperCase();

    // 1. Home / Directory
    if (pathname === '/' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html>
<head><title>Odysseus Local Test Site</title></head>
<body>
  <h1>Odysseus Test Site</h1>
  <p>Deterministic local test environment conforming to Invariant 15.</p>
  <ul>
    <li><a id="link-login" href="/login">Login Page</a></li>
    <li><a id="link-register" href="/register">Register Page</a></li>
    <li><a id="link-dashboard" href="/dashboard">Protected Dashboard</a></li>
    <li><a id="link-search" href="/search">Search Page</a></li>
    <li><a id="link-slow" href="/slow-page">Slow Page</a></li>
    <li><a id="link-broken" href="/broken-page">Broken Page</a></li>
    <li><a id="link-popup" href="/popup-page">Popup & Multi-Tab Page</a></li>
    <li><a id="link-iframe" href="/iframe-page">Iframe Page</a></li>
    <li><a id="link-download" href="/download-page">Download Artifacts Page</a></li>
    <li><a id="link-dynamic" href="/dynamic-page">Dynamic SPA Page</a></li>
    <li><a id="link-facts-a" href="/facts/source-a">Fact Source A</a></li>
    <li><a id="link-facts-b" href="/facts/source-b">Fact Source B</a></li>
  </ul>
</body>
</html>`);
      return;
    }

    // 2. Login Page
    if (pathname === '/login') {
      if (method === 'POST') {
        const body = await this.parseBody(req);
        const email = body.email || '';
        const password = body.password || '';

        if (email === 'test@example.com' && password === 'Password123!') {
          res.writeHead(302, {
            'Set-Cookie': 'session_id=session_mock_123; Path=/; HttpOnly',
            'Location': '/dashboard',
          });
          res.end();
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(this.renderLoginPage('Invalid email or password. Please try again.'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(this.renderLoginPage());
      return;
    }

    // 3. Register Page
    if (pathname === '/register') {
      if (method === 'POST') {
        const body = await this.parseBody(req);
        const username = body.username || '';
        const email = body.email || '';
        const password = body.password || '';
        const confirmPassword = body['confirm-password'] || '';

        if (!username || !email || !password) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(this.renderRegisterPage('All fields are required.'));
          return;
        }

        if (password !== confirmPassword) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(this.renderRegisterPage('Passwords do not match.'));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html>
<html>
<head><title>Registration Success</title></head>
<body>
  <div id="success-banner">Registration successful! Welcome, ${username}.</div>
  <a id="login-link" href="/login">Proceed to Login</a>
</body>
</html>`);
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(this.renderRegisterPage());
      return;
    }

    // 4. Protected Dashboard
    if (pathname === '/dashboard' && method === 'GET') {
      const cookies = this.parseCookies(req);
      if (cookies['session_id'] !== 'session_mock_123') {
        res.writeHead(302, { 'Location': '/login' });
        res.end();
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html>
<head><title>User Dashboard</title></head>
<body>
  <h1>Authenticated Dashboard</h1>
  <div id="user-profile">Welcome, test@example.com</div>
  <div id="account-tier">Tier: Enterprise Member</div>
  <a id="logout-btn" href="/logout">Logout</a>
</body>
</html>`);
      return;
    }

    // 5. Logout
    if (pathname === '/logout') {
      res.writeHead(302, {
        'Set-Cookie': 'session_id=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
        'Location': '/login',
      });
      res.end();
      return;
    }

    // 6. Search Page
    if (pathname === '/search' && method === 'GET') {
      const q = parsedUrl.searchParams.get('q') || '';
      let resultsHtml = '';

      if (q) {
        resultsHtml = `
          <div id="search-results">
            <h2>Results for "${q}"</h2>
            <div class="result-item">
              <a class="result-link" id="top-result-link" href="/search/result/1">Top Result: Pricing and Tier Overview for ${q}</a>
              <p>Comprehensive pricing and documentation on ${q} features.</p>
            </div>
            <div class="result-item">
              <a class="result-link" href="/search/result/2">Secondary Documentation for ${q}</a>
            </div>
          </div>
        `;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html>
<head><title>Search Portal</title></head>
<body>
  <h1>Odysseus Search Portal</h1>
  <form id="search-form" method="GET" action="/search">
    <input type="text" id="search-input" name="q" value="${q}" placeholder="Enter query..." required>
    <button type="submit" id="search-btn">Search</button>
  </form>
  ${resultsHtml}
</body>
</html>`);
      return;
    }

    // Search Result Detail Page
    if (pathname.startsWith('/search/result/') && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html>
<head><title>Search Result Detail</title></head>
<body>
  <h1 id="result-title">Pricing and Tier Overview</h1>
  <p id="result-content">The enterprise plan is priced at $99 per user per month with unlimited browser runtime execution.</p>
</body>
</html>`);
      return;
    }

    // 7. Slow Page
    if (pathname === '/slow-page' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html>
<head><title>Slow Loading Page</title></head>
<body>
  <h1>Slow Loading Test Page</h1>
  <div id="status">Loading dynamic components...</div>
  <div id="btn-container"></div>
  <script>
    setTimeout(function() {
      var btn = document.createElement('button');
      btn.id = 'delayed-btn';
      btn.textContent = 'Delayed Action Button';
      btn.onclick = function() {
        document.getElementById('status').textContent = 'Action successfully executed!';
      };
      document.getElementById('btn-container').appendChild(btn);
      document.getElementById('status').textContent = 'Ready';
    }, 400);
  </script>
</body>
</html>`);
      return;
    }

    // 8. Broken Page
    if (pathname === '/broken-page' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html>
<head><title>Broken Page Recovery Test</title></head>
<body>
  <h1>DOM Mutation & Recovery Test</h1>
  <div id="content-area">
    <div id="mutating-el">Initial Stale Element Content</div>
  </div>
  <button id="bad-btn" onclick="throw new Error('Script execution failure')">Faulty Button</button>
  <button id="stable-btn" onclick="document.getElementById('content-area').textContent = 'Stable element clicked';">Stable Button</button>
  <script>
    // Mutate element after 300ms to test stale element recovery
    setTimeout(function() {
      var el = document.getElementById('mutating-el');
      if (el) {
        el.remove();
        var newEl = document.createElement('div');
        newEl.id = 'mutating-el';
        newEl.textContent = 'Freshly Attached Content';
        document.getElementById('content-area').appendChild(newEl);
      }
    }, 300);
  </script>
</body>
</html>`);
      return;
    }

    // 9. Popup Page
    if (pathname === '/popup-page' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html>
<head><title>Multi-Tab Popup Page</title></head>
<body>
  <h1>Multi-Tab Testing Page</h1>
  <a id="popup-link" target="_blank" href="/popup-content">Open New Tab via Link</a>
  <button id="window-open-btn" onclick="window.open('/popup-content', '_blank');">Open Tab via JS</button>
</body>
</html>`);
      return;
    }

    // 10. Popup Content
    if (pathname === '/popup-content' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html>
<head><title>Popup Content Tab</title></head>
<body>
  <h1 id="popup-header">New Tab Content Loaded</h1>
  <p id="popup-message">This page was opened in a secondary tab.</p>
</body>
</html>`);
      return;
    }

    // 11. Iframe Page
    if (pathname === '/iframe-page' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html>
<head><title>Iframe Container Page</title></head>
<body>
  <h1>Iframe Test Page</h1>
  <p>Outer frame context.</p>
  <iframe id="sub-frame" src="/iframe-content" style="width: 500px; height: 300px; border: 1px solid #ccc;"></iframe>
</body>
</html>`);
      return;
    }

    // 12. Iframe Content
    if (pathname === '/iframe-content' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html>
<head><title>Subframe Content</title></head>
<body>
  <h3>Subframe Embedded Document</h3>
  <form id="iframe-form" onsubmit="event.preventDefault(); document.getElementById('iframe-msg').textContent = 'Subframe submitted: ' + document.getElementById('subframe-input').value;">
    <input type="text" id="subframe-input" placeholder="Subframe input" value="Sample Frame Data">
    <button type="submit" id="subframe-submit">Submit Frame</button>
  </form>
  <div id="iframe-msg"></div>
</body>
</html>`);
      return;
    }

    // 13. Download Page
    if (pathname === '/download-page' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html>
<head><title>Download Artifacts Test</title></head>
<body>
  <h1>Artifact Downloads</h1>
  <a id="download-csv-btn" href="/download/sample.csv" download="sample.csv">Download CSV Data</a>
  <br><br>
  <a id="download-pdf-btn" href="/download/sample.pdf" download="sample.pdf">Download PDF Document</a>
</body>
</html>`);
      return;
    }

    // 14. Sample CSV Download
    if (pathname === '/download/sample.csv' && method === 'GET') {
      const csvData = 'SKU,Product,Price,Category\nSKU-100,Autonomous Engine,$499,Software\nSKU-200,Browser Runtime,$299,Infrastructure\n';
      res.writeHead(200, {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="sample.csv"',
        'Content-Length': Buffer.byteLength(csvData),
      });
      res.end(csvData);
      return;
    }

    // 15. Sample PDF Download
    if (pathname === '/download/sample.pdf' && method === 'GET') {
      const textStreamContent = 'BT /F1 12 Tf 72 712 Td (Odysseus Local Benchmark PDF Content) Tj ET';
      const compressedStream = deflateSync(Buffer.from(textStreamContent, 'utf-8'));

      const pdfBuffer = Buffer.concat([
        Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length ' + compressedStream.length + ' /Filter /FlateDecode >>\nstream\n'),
        compressedStream,
        Buffer.from('\nendstream\nendobj\nxref\n0 2\n0000000000 65535 f \n0000000009 00000 n \ntrailer\n<< /Size 2 /Root 1 0 R >>\nstartxref\n120\n%%EOF\n'),
      ]);

      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="sample.pdf"',
        'Content-Length': pdfBuffer.length,
      });
      res.end(pdfBuffer);
      return;
    }

    // 16. Dynamic SPA Page
    if (pathname === '/dynamic-page' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html>
<head><title>Single Page Application</title></head>
<body>
  <h1>Dynamic Client-Side Application</h1>
  <nav>
    <a id="nav-home" href="#/home">Home Section</a>
    <a id="nav-items" href="#/items">Items Section</a>
  </nav>
  <div id="spa-view">Loading...</div>
  <script>
    function renderRoute() {
      var hash = window.location.hash || '#/home';
      var view = document.getElementById('spa-view');
      if (hash === '#/items') {
        view.innerHTML = '<h2 id="items-header">Item Catalog</h2><ul id="item-list"><li>Item Alpha</li><li>Item Beta</li></ul>';
      } else {
        view.innerHTML = '<h2 id="home-header">Home View</h2><p>Welcome to the SPA test section.</p>';
      }
    }
    window.addEventListener('hashchange', renderRoute);
    window.addEventListener('load', renderRoute);
  </script>
</body>
</html>`);
      return;
    }

    // 17. Fact Source A
    if (pathname === '/facts/source-a' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html>
<head><title>Global Energy Agency - Report A</title></head>
<body>
  <h1>Global Renewable Energy 2026</h1>
  <p id="fact-a">Solar photovoltaic energy generation grew by 32% year-over-year in the latest verified reporting period.</p>
</body>
</html>`);
      return;
    }

    // 18. Fact Source B
    if (pathname === '/facts/source-b' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html>
<head><title>CleanTech Research Institute - Report B</title></head>
<body>
  <h1>Clean Energy Market Review</h1>
  <p id="fact-b">Independent international audits confirm that solar photovoltaic energy generation grew by 32% year-over-year.</p>
</body>
</html>`);
      return;
    }

    // 404 Fallback
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Route Not Found');
  }

  private renderLoginPage(errorMsg?: string): string {
    return `<!DOCTYPE html>
<html>
<head><title>Login Page</title></head>
<body>
  <h1>Member Login</h1>
  ${errorMsg ? `<div id="error-message" style="color: red;">${errorMsg}</div>` : ''}
  <form id="login-form" method="POST" action="/login">
    <div class="field">
      <label for="email">Email</label>
      <input type="email" id="email" name="email" required>
    </div>
    <div class="field">
      <label for="password">Password</label>
      <input type="password" id="password" name="password" required>
    </div>
    <button type="submit" id="login-btn">Log In</button>
  </form>
</body>
</html>`;
  }

  private renderRegisterPage(errorMsg?: string): string {
    return `<!DOCTYPE html>
<html>
<head><title>Register Account</title></head>
<body>
  <h1>Register Account</h1>
  ${errorMsg ? `<div id="error-message" style="color: red;">${errorMsg}</div>` : ''}
  <form id="register-form" method="POST" action="/register">
    <div class="field">
      <label for="username">Username</label>
      <input type="text" id="username" name="username" required>
    </div>
    <div class="field">
      <label for="email">Email</label>
      <input type="email" id="email" name="email" required>
    </div>
    <div class="field">
      <label for="password">Password</label>
      <input type="password" id="password" name="password" required>
    </div>
    <div class="field">
      <label for="confirm-password">Confirm Password</label>
      <input type="password" id="confirm-password" name="confirm-password" required>
    </div>
    <button type="submit" id="register-btn">Create Account</button>
  </form>
</body>
</html>`;
  }
}

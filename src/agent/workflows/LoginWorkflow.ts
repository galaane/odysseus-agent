import type { Page } from 'playwright-core';
import type { CredentialProvider } from '../../credentials/types.js';
import { CredentialInjector } from '../../credentials/CredentialInjector.js';
import type { AuthResult, LoginFormSelectors } from './types.js';
import { ErrorCodes } from '../../browser/BrowserError.js';
import type { Logger } from '../../logging/Logger.js';

export class LoginWorkflow {
  constructor(
    private readonly credentialProvider: CredentialProvider,
    private readonly logger?: Logger
  ) {}

  /**
   * Executes the autonomous login workflow on the given page.
   */
  public async execute(page: Page, selectors?: LoginFormSelectors): Promise<AuthResult> {
    if (!page) {
      return {
        success: false,
        authenticated: false,
        code: ErrorCodes.BROWSER_NOT_CONNECTED,
        reason: 'Page is not available',
      };
    }

    const currentUrl = page.url();
    let domain = 'unknown';
    try {
      domain = new URL(currentUrl).hostname;
    } catch {
      domain = currentUrl;
    }

    this.logger?.info('LoginWorkflow', `Starting login workflow for domain: ${domain}`);

    // 1. CAPTCHA / Anti-Bot Inspection (Invariant 12)
    const hasCaptcha = await this.detectCaptcha(page);
    if (hasCaptcha) {
      this.logger?.warn('LoginWorkflow', `Bot challenge or CAPTCHA detected on ${domain}. Aborting per Invariant 12.`);
      return {
        success: false,
        authenticated: false,
        code: ErrorCodes.VERIFICATION_REQUIRED,
        reason: 'CAPTCHA or anti-bot challenge detected. Automated bypass prohibited by Invariant 12.',
      };
    }

    // 2. Retrieve Credentials from Vault (Invariant 11)
    const credential = await this.credentialProvider.getCredential(domain, 'login');
    if (!credential) {
      this.logger?.warn('LoginWorkflow', `No credentials provisioned for domain: ${domain}`);
      return {
        success: false,
        authenticated: false,
        code: ErrorCodes.AUTH_REQUIRED,
        reason: `No provisioned credentials found in vault for domain: ${domain}`,
      };
    }

    // 3. Resolve Form Selectors
    const usernameSel = selectors?.usernameSelector || (await this.findUsernameSelector(page));
    const passwordSel = selectors?.passwordSelector || (await this.findPasswordSelector(page));
    const submitSel = selectors?.submitSelector || (await this.findSubmitSelector(page));

    if (!usernameSel || !passwordSel) {
      return {
        success: false,
        authenticated: false,
        code: ErrorCodes.ELEMENT_NOT_FOUND,
        reason: `Could not identify login inputs on page (User: ${usernameSel}, Pass: ${passwordSel})`,
      };
    }

    // 4. Inject Credentials directly into DOM without logging (Invariant 11)
    try {
      this.logger?.info('LoginWorkflow', `Injecting credentials for username: ${credential.username} into DOM`);
      await CredentialInjector.inject(page, usernameSel, passwordSel, credential);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        authenticated: false,
        code: ErrorCodes.UNKNOWN_ERROR,
        reason: `Credential injection failed: ${message}`,
      };
    }

    // 5. Submit Form
    try {
      if (submitSel) {
        await page.locator(submitSel).first().click();
      } else {
        await page.locator(passwordSel).first().press('Enter');
      }

      // Wait briefly for response / navigation
      await page.waitForLoadState?.('domcontentloaded').catch(() => {});
      await new Promise((res) => setTimeout(res, 500));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger?.warn('LoginWorkflow', `Form submission encountered error: ${message}`);
    }

    // 6. Empirical Session Verification (Invariants 3 & 10)
    return await this.verifySession(page, credential.username);
  }

  /**
   * Detects CAPTCHA, Turnstile, or anti-bot widgets (Invariant 12).
   */
  public async detectCaptcha(page: Page): Promise<boolean> {
    const captchaSelectors = [
      'iframe[src*="recaptcha"]',
      'iframe[src*="hcaptcha"]',
      'iframe[src*="challenges.cloudflare.com"]',
      'iframe[src*="turnstile"]',
      '.cf-turnstile',
      '.g-recaptcha',
      '.h-captcha',
      '[data-sitekey]',
      '#cf-challenge-running',
    ];

    for (const sel of captchaSelectors) {
      try {
        const count = await page.locator(sel).count();
        if (count > 0) return true;
      } catch {
        // Ignore locator errors
      }
    }
    return false;
  }

  /**
   * Verifies if authentication succeeded by inspecting post-login indicators.
   */
  public async verifySession(page: Page, username: string): Promise<AuthResult> {
    // 1. Check for error alerts
    const errorSelectors = [
      '.alert-danger',
      '.alert-error',
      '[role="alert"]',
      '.error-message',
      ':has-text("Invalid username or password")',
      ':has-text("Invalid credentials")',
      ':has-text("Incorrect password")',
    ];

    for (const sel of errorSelectors) {
      try {
        const loc = page.locator(sel);
        if ((await loc.count()) > 0) {
          const target = typeof loc.first === 'function' ? loc.first() : loc;
          if (await target.isVisible()) {
            const text = await target.textContent();
            return {
              success: false,
              authenticated: false,
              code: ErrorCodes.AUTH_FAILED,
              reason: text?.trim() || 'Invalid credentials or login error displayed.',
            };
          }
        }
      } catch {
        // Continue
      }
    }

    // 2. Check for success indicators (logout button, user avatar, profile badge)
    const successSelectors = [
      'a:has-text("Log out")',
      'a:has-text("Sign out")',
      'a:has-text("Logout")',
      'a:has-text("Signout")',
      'button:has-text("Log out")',
      'button:has-text("Sign out")',
      'button:has-text("Logout")',
      'button:has-text("Signout")',
      '[aria-label*="account" i]',
      '[aria-label*="profile" i]',
      '.user-avatar',
      '.profile-badge',
      '[data-testid="user-profile"]',
    ];

    for (const sel of successSelectors) {
      try {
        const loc = page.locator(sel);
        if ((await loc.count()) > 0) {
          const target = typeof loc.first === 'function' ? loc.first() : loc;
          if (await target.isVisible()) {
            return {
              success: true,
              authenticated: true,
              user: username,
              reason: `Session verified via indicator: ${sel}`,
            };
          }
        }
      } catch {
        // Continue
      }
    }

    // 3. Fallback: If login form disappeared and no error banner is visible
    const passInputCount = await page.locator('input[type="password"]').count().catch(() => 0);
    if (passInputCount === 0) {
      return {
        success: true,
        authenticated: true,
        user: username,
        reason: 'Login form dismissed, no authentication errors detected.',
      };
    }

    return {
      success: false,
      authenticated: false,
      code: ErrorCodes.AUTH_FAILED,
      reason: 'Could not verify authenticated session state.',
    };
  }

  private async findUsernameSelector(page: Page): Promise<string | null> {
    const candidates = [
      'input[name="username"]',
      'input[name="email"]',
      'input[type="email"]',
      '#username',
      '#email',
      'input[autocomplete="username"]',
      'input[type="text"]',
    ];

    for (const sel of candidates) {
      try {
        if ((await page.locator(sel).count()) > 0) return sel;
      } catch {
        // ignore
      }
    }
    return null;
  }

  private async findPasswordSelector(page: Page): Promise<string | null> {
    const candidates = [
      'input[type="password"]',
      'input[name="password"]',
      '#password',
      'input[autocomplete="current-password"]',
    ];

    for (const sel of candidates) {
      try {
        if ((await page.locator(sel).count()) > 0) return sel;
      } catch {
        // ignore
      }
    }
    return null;
  }

  private async findSubmitSelector(page: Page): Promise<string | null> {
    const candidates = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Sign in")',
      'button:has-text("Log in")',
      'button:has-text("Login")',
      'button:has-text("Submit")',
    ];

    for (const sel of candidates) {
      try {
        if ((await page.locator(sel).count()) > 0) return sel;
      } catch {
        // ignore
      }
    }
    return null;
  }
}

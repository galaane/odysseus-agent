import type { Page } from 'playwright-core';
import type { Credential } from '../../credentials/types.js';
import { CredentialInjector } from '../../credentials/CredentialInjector.js';
import type { AuthResult, RegistrationFormSelectors } from './types.js';
import { ErrorCodes } from '../../browser/BrowserError.js';
import type { Logger } from '../../logging/Logger.js';

export class RegistrationWorkflow {
  constructor(private readonly logger?: Logger) {}

  /**
   * Executes the autonomous registration workflow on the given page.
   */
  public async execute(
    page: Page,
    credential: Credential,
    selectors?: RegistrationFormSelectors
  ): Promise<AuthResult> {
    if (!page) {
      return {
        success: false,
        authenticated: false,
        code: ErrorCodes.BROWSER_NOT_CONNECTED,
        reason: 'Page is not available',
      };
    }

    const currentUrl = page.url();
    this.logger?.info('RegistrationWorkflow', `Starting registration workflow for user ${credential.username} on ${currentUrl}`);

    // 1. CAPTCHA / Anti-Bot Inspection (Invariant 12)
    const hasCaptcha = await this.detectCaptcha(page);
    if (hasCaptcha) {
      this.logger?.warn('RegistrationWorkflow', 'CAPTCHA or bot challenge detected during registration. Aborting per Invariant 12.');
      return {
        success: false,
        authenticated: false,
        code: ErrorCodes.VERIFICATION_REQUIRED,
        reason: 'CAPTCHA detected during registration. Automated bypass prohibited by Invariant 12.',
      };
    }

    // 2. Resolve Selectors
    const usernameSel = selectors?.usernameSelector || (await this.findUsernameSelector(page));
    const emailSel = selectors?.emailSelector || (await this.findEmailSelector(page));
    const passwordSel = selectors?.passwordSelector || (await this.findPasswordSelector(page));
    const confirmPasswordSel = selectors?.confirmPasswordSelector || (await this.findConfirmPasswordSelector(page));
    const submitSel = selectors?.submitSelector || (await this.findSubmitSelector(page));

    if (!passwordSel) {
      return {
        success: false,
        authenticated: false,
        code: ErrorCodes.ELEMENT_NOT_FOUND,
        reason: 'Could not identify password input on registration form.',
      };
    }

    // 3. Inject Registration Data (Invariant 11)
    try {
      await CredentialInjector.injectRegistration(
        page,
        {
          usernameSelector: usernameSel || undefined,
          emailSelector: emailSel || undefined,
          passwordSelector: passwordSel,
          confirmPasswordSelector: confirmPasswordSel || undefined,
        },
        credential
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        authenticated: false,
        code: ErrorCodes.UNKNOWN_ERROR,
        reason: `Credential injection failed: ${message}`,
      };
    }

    // 4. Submit Registration Form
    try {
      if (submitSel) {
        await page.locator(submitSel).first().click();
      } else {
        await page.locator(passwordSel).first().press('Enter');
      }

      await page.waitForLoadState?.('domcontentloaded').catch(() => {});
      await new Promise((res) => setTimeout(res, 500));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger?.warn('RegistrationWorkflow', `Registration submit encountered error: ${message}`);
    }

    // 5. Verification
    return await this.verifyRegistration(page, credential.username);
  }

  public async detectCaptcha(page: Page): Promise<boolean> {
    const captchaSelectors = [
      'iframe[src*="recaptcha"]',
      'iframe[src*="hcaptcha"]',
      'iframe[src*="turnstile"]',
      '.cf-turnstile',
      '.g-recaptcha',
      '.h-captcha',
      '[data-sitekey]',
    ];

    for (const sel of captchaSelectors) {
      try {
        if ((await page.locator(sel).count()) > 0) return true;
      } catch {
        // ignore
      }
    }
    return false;
  }

  public async verifyRegistration(page: Page, username: string): Promise<AuthResult> {
    // 1. Check for error messages
    const errorSelectors = [
      '.alert-danger',
      '.alert-error',
      '[role="alert"]',
      '.error-message',
      ':has-text("already exists")',
      ':has-text("Username taken")',
      ':has-text("Email already registered")',
      ':has-text("Password too weak")',
    ];

    for (const sel of errorSelectors) {
      try {
        const locator = page.locator(sel).first();
        if ((await locator.count()) > 0 && (await locator.isVisible())) {
          const text = await locator.textContent();
          return {
            success: false,
            authenticated: false,
            code: ErrorCodes.AUTH_FAILED,
            reason: text?.trim() || 'Registration error displayed.',
          };
        }
      } catch {
        // continue
      }
    }

    // 2. Check for success notices
    const successSelectors = [
      ':has-text("Registration successful")',
      ':has-text("Account created")',
      ':has-text("Welcome")',
      ':has-text("Verification email sent")',
      'a:has-text("Log out")',
      'button:has-text("Log out")',
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
              reason: `Registration verified via indicator: ${sel}`,
            };
          }
        }
      } catch {
        // continue
      }
    }

    // 3. Fallback: Form submitted if password input is no longer present
    const passInputCount = await page.locator('input[type="password"]').count().catch(() => 0);
    if (passInputCount === 0) {
      return {
        success: true,
        authenticated: true,
        user: username,
        reason: 'Registration form completed and dismissed.',
      };
    }

    return {
      success: false,
      authenticated: false,
      code: ErrorCodes.AUTH_FAILED,
      reason: 'Could not verify registration completion.',
    };
  }

  private async findUsernameSelector(page: Page): Promise<string | null> {
    const candidates = ['input[name="username"]', '#username', 'input[autocomplete="username"]', 'input[name="name"]'];
    for (const sel of candidates) {
      try {
        if ((await page.locator(sel).count()) > 0) return sel;
      } catch {}
    }
    return null;
  }

  private async findEmailSelector(page: Page): Promise<string | null> {
    const candidates = ['input[type="email"]', 'input[name="email"]', '#email', 'input[autocomplete="email"]'];
    for (const sel of candidates) {
      try {
        if ((await page.locator(sel).count()) > 0) return sel;
      } catch {}
    }
    return null;
  }

  private async findPasswordSelector(page: Page): Promise<string | null> {
    const candidates = ['input[type="password"]:not([name*="confirm" i])', 'input[name="password"]', '#password'];
    for (const sel of candidates) {
      try {
        if ((await page.locator(sel).count()) > 0) return sel;
      } catch {}
    }
    return null;
  }

  private async findConfirmPasswordSelector(page: Page): Promise<string | null> {
    const candidates = [
      'input[name*="confirm" i]',
      'input[id*="confirm" i]',
      'input[placeholder*="confirm" i]',
      'input[type="password"]:nth-of-type(2)',
    ];
    for (const sel of candidates) {
      try {
        if ((await page.locator(sel).count()) > 0) return sel;
      } catch {}
    }
    return null;
  }

  private async findSubmitSelector(page: Page): Promise<string | null> {
    const candidates = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Sign up")',
      'button:has-text("Register")',
      'button:has-text("Create account")',
    ];
    for (const sel of candidates) {
      try {
        if ((await page.locator(sel).count()) > 0) return sel;
      } catch {}
    }
    return null;
  }
}

import type { Page } from 'playwright-core';
import type { Credential } from './types.js';
import { generateTotp } from './TotpGenerator.js';

export class CredentialInjector {
  /**
   * Injects credentials directly into DOM inputs via Playwright Core.
   * Enforces Invariant 11: The password is typed directly into the browser's DOM
   * input without ever being logged, traced, or added to LLM conversation histories.
   */
  public static async inject(
    page: Page,
    usernameSelector: string,
    passwordSelector: string,
    credential: Credential
  ): Promise<void> {
    if (!page) {
      throw new Error('Cannot inject credentials: page is not initialized');
    }

    // 1. Fill username / email
    const userLocator = page.locator(usernameSelector).first();
    await userLocator.fill(credential.username);

    // 2. Directly fill password into the password input
    const passLocator = page.locator(passwordSelector).first();
    await passLocator.fill(credential.password);
  }

  /**
   * Injects credentials with confirmation password (useful for registration forms).
   */
  public static async injectRegistration(
    page: Page,
    selectors: {
      usernameSelector?: string;
      emailSelector?: string;
      passwordSelector: string;
      confirmPasswordSelector?: string;
    },
    credential: Credential
  ): Promise<void> {
    if (!page) {
      throw new Error('Cannot inject credentials: page is not initialized');
    }

    if (selectors.usernameSelector) {
      await page.locator(selectors.usernameSelector).first().fill(credential.username);
    }

    if (selectors.emailSelector && credential.email) {
      await page.locator(selectors.emailSelector).first().fill(credential.email);
    }

    await page.locator(selectors.passwordSelector).first().fill(credential.password);

    if (selectors.confirmPasswordSelector) {
      await page.locator(selectors.confirmPasswordSelector).first().fill(credential.password);
    }
  }

  /**
   * Injects a generated 6-digit TOTP code directly into a 2FA/MFA pin input field.
   * Enforces Invariant 11: The code is generated and filled directly into the DOM
   * without ever being transmitted to LLM context or logs.
   */
  public static async injectTotp(
    page: Page,
    totpSelector: string,
    totpSecret: string
  ): Promise<string> {
    if (!page) {
      throw new Error('Cannot inject TOTP: page is not initialized');
    }

    const code = generateTotp(totpSecret);
    const pinLocator = page.locator(totpSelector).first();
    await pinLocator.fill(code);
    return code;
  }
}


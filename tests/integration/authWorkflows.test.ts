import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Page } from 'playwright-core';
import { CredentialVault } from '../../src/credentials/CredentialVault.js';
import { LoginWorkflow } from '../../src/agent/workflows/LoginWorkflow.js';
import { RegistrationWorkflow } from '../../src/agent/workflows/RegistrationWorkflow.js';
import { ErrorCodes } from '../../src/browser/BrowserError.js';
import { Logger } from '../../src/logging/Logger.js';

describe('Authentication Workflows & Verification (Invariants 11 & 12)', () => {
  let vault: CredentialVault;
  let logger: Logger;

  beforeEach(() => {
    vault = new CredentialVault();
    logger = new Logger('error');
  });

  describe('LoginWorkflow', () => {
    it('should complete login and verify authenticated session state via logout indicator', async () => {
      vault.setCredential('portal.local', {
        username: 'authorized_agent',
        password: 'ValidSecretPassword2026',
      });

      const fillCalls: Record<string, string> = {};
      let submitClicked = false;

      const mockPage = {
        url: () => 'https://portal.local/login',
        locator: vi.fn((selector: string) => {
          // CAPTCHA check
          if (selector.includes('recaptcha') || selector.includes('turnstile')) {
            return { count: vi.fn(async () => 0) };
          }
          // Input discovery
          if (selector.includes('username') || selector === '#username') {
            return {
              count: vi.fn(async () => 1),
              first: () => ({
                fill: vi.fn(async (val: string) => {
                  fillCalls['username'] = val;
                }),
              }),
            };
          }
          if (selector.includes('password') || selector === '#password') {
            return {
              count: vi.fn(async () => 1),
              first: () => ({
                fill: vi.fn(async (val: string) => {
                  fillCalls['password'] = val;
                }),
              }),
            };
          }
          if (selector.includes('submit')) {
            return {
              count: vi.fn(async () => 1),
              first: () => ({
                click: vi.fn(async () => {
                  submitClicked = true;
                }),
              }),
            };
          }
          // Post-login verification: Logout button is present
          if (selector.includes('Log out') || selector.includes('Logout')) {
            return {
              count: vi.fn(async () => 1),
              isVisible: vi.fn(async () => true),
              first: () => ({
                count: vi.fn(async () => 1),
                isVisible: vi.fn(async () => true),
              }),
            };
          }
          // Error check
          if (selector.includes('alert') || selector.includes('Invalid')) {
            return {
              count: vi.fn(async () => 0),
              isVisible: vi.fn(async () => false),
            };
          }
          return {
            count: vi.fn(async () => 0),
            first: () => ({ fill: vi.fn(), click: vi.fn() }),
            isVisible: vi.fn(async () => false),
          };
        }),
        waitForLoadState: vi.fn(async () => {}),
      } as unknown as Page;

      const workflow = new LoginWorkflow(vault, logger);
      const result = await workflow.execute(mockPage);

      expect(result.success).toBe(true);
      expect(result.authenticated).toBe(true);
      expect(result.user).toBe('authorized_agent');
      expect(fillCalls['username']).toBe('authorized_agent');
      expect(fillCalls['password']).toBe('ValidSecretPassword2026');
      expect(submitClicked).toBe(true);
      expect(result.reason).toContain('Session verified');
    });

    it('should detect authentication failure banner and report auth failure', async () => {
      vault.setCredential('store.local', {
        username: 'wrong_agent',
        password: 'IncorrectPassword',
      });

      const mockPage = {
        url: () => 'https://store.local/login',
        locator: vi.fn((selector: string) => {
          if (selector.includes('recaptcha') || selector.includes('turnstile')) {
            return { count: vi.fn(async () => 0) };
          }
          if (selector.includes('username')) {
            return {
              count: vi.fn(async () => 1),
              first: () => ({ fill: vi.fn(async () => {}) }),
            };
          }
          if (selector.includes('password')) {
            return {
              count: vi.fn(async () => 1),
              first: () => ({ fill: vi.fn(async () => {}) }),
            };
          }
          if (selector.includes('submit')) {
            return {
              count: vi.fn(async () => 1),
              first: () => ({ click: vi.fn(async () => {}) }),
            };
          }
          // Error banner present!
          if (selector.includes('Invalid credentials') || selector.includes('alert')) {
            return {
              count: vi.fn(async () => 1),
              first: () => ({
                count: vi.fn(async () => 1),
                isVisible: vi.fn(async () => true),
                textContent: vi.fn(async () => 'Invalid username or password.'),
              }),
              isVisible: vi.fn(async () => true),
              textContent: vi.fn(async () => 'Invalid username or password.'),
            };
          }
          return {
            count: vi.fn(async () => 0),
            first: () => ({ fill: vi.fn(), click: vi.fn(), isVisible: vi.fn(async () => false) }),
            isVisible: vi.fn(async () => false),
          };
        }),
        waitForLoadState: vi.fn(async () => {}),
      } as unknown as Page;

      const workflow = new LoginWorkflow(vault, logger);
      const result = await workflow.execute(mockPage);

      expect(result.success).toBe(false);
      expect(result.authenticated).toBe(false);
      expect(result.code).toBe(ErrorCodes.AUTH_FAILED);
      expect(result.reason).toContain('Invalid username or password');
    });

    it('should detect CAPTCHA challenge and abort immediately without bypass (Invariant 12)', async () => {
      vault.setCredential('cloudflare-protected.local', {
        username: 'test_user',
        password: 'Password123',
      });

      const mockPage = {
        url: () => 'https://cloudflare-protected.local/login',
        locator: vi.fn((selector: string) => {
          if (selector.includes('recaptcha') || selector.includes('turnstile')) {
            return { count: vi.fn(async () => 1) }; // CAPTCHA present!
          }
          return { count: vi.fn(async () => 0) };
        }),
      } as unknown as Page;

      const workflow = new LoginWorkflow(vault, logger);
      const result = await workflow.execute(mockPage);

      expect(result.success).toBe(false);
      expect(result.authenticated).toBe(false);
      expect(result.code).toBe(ErrorCodes.VERIFICATION_REQUIRED);
      expect(result.reason).toContain('Automated bypass prohibited by Invariant 12');
    });

    it('should report AUTH_REQUIRED if no credentials exist for domain', async () => {
      const mockPage = {
        url: () => 'https://unregistered-domain.org/login',
        locator: vi.fn(() => ({ count: vi.fn(async () => 0) })),
      } as unknown as Page;

      const workflow = new LoginWorkflow(vault, logger);
      const result = await workflow.execute(mockPage);

      expect(result.success).toBe(false);
      expect(result.code).toBe(ErrorCodes.AUTH_REQUIRED);
    });
  });

  describe('RegistrationWorkflow', () => {
    it('should complete registration form submission and verify success', async () => {
      const fillCalls: Record<string, string> = {};

      const mockPage = {
        url: () => 'https://portal.local/signup',
        locator: vi.fn((selector: string) => {
          if (selector.includes('recaptcha') || selector.includes('turnstile')) {
            return { count: vi.fn(async () => 0) };
          }
          if (selector.includes('username')) {
            return {
              count: vi.fn(async () => 1),
              first: () => ({
                fill: vi.fn(async (v: string) => {
                  fillCalls['username'] = v;
                }),
              }),
            };
          }
          if (selector.includes('email')) {
            return {
              count: vi.fn(async () => 1),
              first: () => ({
                fill: vi.fn(async (v: string) => {
                  fillCalls['email'] = v;
                }),
              }),
            };
          }
          if (selector.includes('password')) {
            return {
              count: vi.fn(async () => 1),
              first: () => ({
                fill: vi.fn(async (v: string) => {
                  fillCalls['password'] = v;
                }),
              }),
            };
          }
          if (selector.includes('submit') || selector.includes('Sign up') || selector.includes('Register')) {
            return {
              count: vi.fn(async () => 1),
              first: () => ({ click: vi.fn(async () => {}) }),
            };
          }
          if (selector.includes('Account created') || selector.includes('Registration successful')) {
            return {
              count: vi.fn(async () => 1),
              isVisible: vi.fn(async () => true),
              first: () => ({
                count: vi.fn(async () => 1),
                isVisible: vi.fn(async () => true),
              }),
            };
          }
          return {
            count: vi.fn(async () => 0),
            first: () => ({ fill: vi.fn(), click: vi.fn() }),
            isVisible: vi.fn(async () => false),
          };
        }),
        waitForLoadState: vi.fn(async () => {}),
      } as unknown as Page;

      const workflow = new RegistrationWorkflow(logger);
      const result = await workflow.execute(mockPage, {
        username: 'brand_new_agent',
        email: 'agent@portal.local',
        password: 'RegistrationSecret2026!',
      });

      expect(result.success).toBe(true);
      expect(result.authenticated).toBe(true);
      expect(result.user).toBe('brand_new_agent');
      expect(fillCalls['username']).toBe('brand_new_agent');
      expect(fillCalls['email']).toBe('agent@portal.local');
      expect(fillCalls['password']).toBe('RegistrationSecret2026!');
    });

    it('should halt with VERIFICATION_REQUIRED if CAPTCHA detected on registration form', async () => {
      const mockPage = {
        url: () => 'https://protected.local/signup',
        locator: vi.fn((selector: string) => {
          if (selector.includes('recaptcha') || selector.includes('turnstile')) {
            return { count: vi.fn(async () => 1) };
          }
          return { count: vi.fn(async () => 0) };
        }),
      } as unknown as Page;

      const workflow = new RegistrationWorkflow(logger);
      const result = await workflow.execute(mockPage, {
        username: 'agent',
        password: 'password',
      });

      expect(result.success).toBe(false);
      expect(result.code).toBe(ErrorCodes.VERIFICATION_REQUIRED);
    });
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Page } from 'playwright-core';
import { CredentialVault } from '../../src/credentials/CredentialVault.js';
import { CredentialInjector } from '../../src/credentials/CredentialInjector.js';

describe('Credential Vault & DOM Injection Subsystem (Invariant 11: Isolated Credentials)', () => {
  describe('CredentialVault', () => {
    let vault: CredentialVault;

    beforeEach(() => {
      vault = new CredentialVault();
    });

    it('should register, retrieve, and normalize domain credentials', async () => {
      vault.setCredential('https://Auth.Example.COM/login', {
        username: 'agent_tester',
        password: 'SuperSecretPassword!2026',
        email: 'agent@example.com',
      });

      expect(await vault.hasCredential('auth.example.com')).toBe(true);
      expect(await vault.hasCredential('unknown.org')).toBe(false);

      const cred = await vault.getCredential('auth.example.com');
      expect(cred).not.toBeNull();
      expect(cred?.username).toBe('agent_tester');
      expect(cred?.password).toBe('SuperSecretPassword!2026');
      expect(cred?.email).toBe('agent@example.com');
    });

    it('should fallback to parent domain when subdomain credential is not explicitly set', async () => {
      vault.setCredential('store.local', {
        username: 'store_user',
        password: 'StorePassword456',
      });

      // Querying sub.portal.store.local should fallback to store.local
      const cred = await vault.getCredential('sub.portal.store.local');
      expect(cred).not.toBeNull();
      expect(cred?.username).toBe('store_user');
      expect(cred?.password).toBe('StorePassword456');
    });

    it('should list and remove domains cleanly', async () => {
      vault.setCredential('site1.com', { username: 'u1', password: 'p1' });
      vault.setCredential('site2.com', { username: 'u2', password: 'p2' });

      expect(vault.listDomains()).toEqual(['site1.com', 'site2.com']);

      const removed = vault.removeCredential('site1.com');
      expect(removed).toBe(true);
      expect(await vault.hasCredential('site1.com')).toBe(false);
      expect(vault.listDomains()).toEqual(['site2.com']);
    });

    it('should NEVER leak passwords in JSON.stringify or toString (Invariant 11)', () => {
      vault.setCredential('bank.secure.com', {
        username: 'bank_agent',
        password: 'TopSecretBankMasterKey999',
        email: 'bank@secure.com',
      });

      // 1. Check toString()
      const strOutput = vault.toString();
      expect(strOutput).not.toContain('TopSecretBankMasterKey999');
      expect(strOutput).not.toContain('bank_agent');
      expect(strOutput).toBe('[CredentialVault: 1 domains registered]');

      // 2. Check JSON.stringify()
      const jsonOutput = JSON.stringify(vault);
      expect(jsonOutput).not.toContain('TopSecretBankMasterKey999');
      expect(jsonOutput).toContain('[REDACTED]');
      expect(jsonOutput).toContain('bank_agent');
    });
  });

  describe('CredentialInjector (Direct Playwright DOM Injection)', () => {
    it('should directly inject username and password into DOM inputs', async () => {
      const fillUsernameMock = vi.fn(async () => {});
      const fillPasswordMock = vi.fn(async () => {});

      const mockPage = {
        locator: vi.fn((selector: string) => {
          if (selector === '#user-input') {
            return {
              first: () => ({ fill: fillUsernameMock }),
            };
          }
          if (selector === '#pass-input') {
            return {
              first: () => ({ fill: fillPasswordMock }),
            };
          }
          return { first: () => ({ fill: vi.fn() }) };
        }),
      } as unknown as Page;

      await CredentialInjector.inject(
        mockPage,
        '#user-input',
        '#pass-input',
        {
          username: 'direct_user',
          password: 'DirectPassword789',
        }
      );

      expect(fillUsernameMock).toHaveBeenCalledWith('direct_user');
      expect(fillPasswordMock).toHaveBeenCalledWith('DirectPassword789');
    });

    it('should inject registration fields including confirmation password', async () => {
      const fillCalls: Record<string, string> = {};

      const mockPage = {
        locator: vi.fn((selector: string) => ({
          first: () => ({
            fill: vi.fn(async (val: string) => {
              fillCalls[selector] = val;
            }),
          }),
        })),
      } as unknown as Page;

      await CredentialInjector.injectRegistration(
        mockPage,
        {
          usernameSelector: '#reg-user',
          emailSelector: '#reg-email',
          passwordSelector: '#reg-pass',
          confirmPasswordSelector: '#reg-confirm',
        },
        {
          username: 'newbie',
          email: 'newbie@domain.test',
          password: 'SecretRegistrationPassword2026',
        }
      );

      expect(fillCalls['#reg-user']).toBe('newbie');
      expect(fillCalls['#reg-email']).toBe('newbie@domain.test');
      expect(fillCalls['#reg-pass']).toBe('SecretRegistrationPassword2026');
      expect(fillCalls['#reg-confirm']).toBe('SecretRegistrationPassword2026');
    });
  });
});

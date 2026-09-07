import type { Credential, CredentialProvider } from './types.js';

export class CredentialVault implements CredentialProvider {
  private credentials: Map<string, Credential> = new Map();

  constructor(initialCredentials?: Record<string, Credential>) {
    if (initialCredentials) {
      for (const [domain, cred] of Object.entries(initialCredentials)) {
        this.setCredential(domain, cred);
      }
    }
  }

  /**
   * Normalizes domain name into a clean hostname.
   */
  private normalizeDomain(input: string): string {
    let clean = input.trim().toLowerCase();
    if (clean.includes('://')) {
      try {
        clean = new URL(clean).hostname;
      } catch {
        // Use stripped string if URL parsing fails
        clean = clean.replace(/^[a-z]+:\/\//, '').split('/')[0];
      }
    }
    return clean.replace(/:\d+$/, '');
  }

  /**
   * Registers or updates a credential for a target domain.
   */
  public setCredential(domain: string, credential: Credential): void {
    const normalized = this.normalizeDomain(domain);
    this.credentials.set(normalized, { ...credential });
  }

  /**
   * Retrieves a credential for a domain with fallback to parent domain.
   */
  public async getCredential(domain: string, _purpose?: string): Promise<Credential | null> {
    const normalized = this.normalizeDomain(domain);

    // 1. Direct match
    if (this.credentials.has(normalized)) {
      const cred = this.credentials.get(normalized)!;
      return { ...cred };
    }

    // 2. Subdomain fallback: e.g. "sub.domain.com" -> fallback to "domain.com"
    const parts = normalized.split('.');
    while (parts.length > 2) {
      parts.shift();
      const parentDomain = parts.join('.');
      if (this.credentials.has(parentDomain)) {
        const cred = this.credentials.get(parentDomain)!;
        return { ...cred };
      }
    }

    return null;
  }

  /**
   * Checks whether a credential exists for the given domain.
   */
  public async hasCredential(domain: string): Promise<boolean> {
    const cred = await this.getCredential(domain);
    return cred !== null;
  }

  /**
   * Removes a credential for a given domain.
   */
  public removeCredential(domain: string): boolean {
    const normalized = this.normalizeDomain(domain);
    return this.credentials.delete(normalized);
  }

  /**
   * Returns a list of domains registered in the vault.
   */
  public listDomains(): string[] {
    return Array.from(this.credentials.keys());
  }

  /**
   * Clears all credentials in the vault.
   */
  public clear(): void {
    this.credentials.clear();
  }

  /**
   * Enforces Invariant 11 (Isolated Credentials):
   * Ensures JSON.stringify(vault) never exposes passwords or secrets.
   */
  public toJSON(): Record<string, unknown> {
    const safeOverview: Record<string, { username: string; email?: string; password: '[REDACTED]' }> = {};
    for (const [domain, cred] of this.credentials.entries()) {
      safeOverview[domain] = {
        username: cred.username,
        email: cred.email,
        password: '[REDACTED]',
      };
    }
    return {
      vaultType: 'CredentialVault',
      domainsRegistered: this.credentials.size,
      credentials: safeOverview,
    };
  }

  /**
   * Enforces Invariant 11:
   * String representations omit credentials.
   */
  public toString(): string {
    return `[CredentialVault: ${this.credentials.size} domains registered]`;
  }
}

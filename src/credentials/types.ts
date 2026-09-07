export interface Credential {
  username: string;
  password: string;
  email?: string;
  totpSecret?: string;
  metadata?: Record<string, string>;
}

export interface CredentialProvider {
  getCredential(domain: string, purpose?: string): Promise<Credential | null>;
  hasCredential(domain: string): Promise<boolean>;
}

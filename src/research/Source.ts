export interface Source {
  id: string;
  url: string;
  title?: string;
  domain: string;
  accessedAt: string;
  relevance?: number;
}

/**
 * Extracts a normalized hostname/domain from a URL string.
 */
export function extractDomain(url: string): string {
  try {
    const hasProtocol = /^[a-z]+:\/\//i.test(url);
    const parsed = new URL(hasProtocol ? url : `http://${url}`);
    return parsed.hostname.toLowerCase() || 'unknown';
  } catch {
    // Fallback: strip protocol and path
    const stripped = url.replace(/^[a-z]+:\/\//i, '').split('/')[0];
    return stripped.split(':')[0].toLowerCase() || 'unknown';
  }
}

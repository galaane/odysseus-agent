import { extractDomain, type Source } from './Source.js';

export class SourceTracker {
  private sources: Map<string, Source> = new Map();
  private sourceCounter = 0;

  /**
   * Records a visited source URL. If already recorded, updates title, accessedAt, or relevance.
   */
  public recordSource(url: string, title?: string, relevance?: number): Source {
    if (!url || url === 'about:blank') {
      throw new Error('Cannot record invalid or blank URL as a source');
    }

    const domain = extractDomain(url);

    // Check for existing source with same URL
    for (const existing of this.sources.values()) {
      if (existing.url === url) {
        if (title && !existing.title) existing.title = title;
        if (relevance !== undefined) existing.relevance = relevance;
        existing.accessedAt = new Date().toISOString();
        return existing;
      }
    }

    this.sourceCounter++;
    const id = `src_${String(this.sourceCounter).padStart(3, '0')}`;

    const newSource: Source = {
      id,
      url,
      title: title || undefined,
      domain,
      accessedAt: new Date().toISOString(),
      relevance: relevance ?? 1.0,
    };

    this.sources.set(id, newSource);
    return newSource;
  }

  public getSource(id: string): Source | undefined {
    return this.sources.get(id);
  }

  public getSourceByUrl(url: string): Source | undefined {
    for (const source of this.sources.values()) {
      if (source.url === url) return source;
    }
    return undefined;
  }

  public getAllSources(): Source[] {
    return Array.from(this.sources.values());
  }

  public getUniqueDomains(): string[] {
    const domains = new Set<string>();
    for (const source of this.sources.values()) {
      domains.add(source.domain);
    }
    return Array.from(domains);
  }

  public getSourcesForDomain(domain: string): Source[] {
    const normalized = domain.toLowerCase();
    return Array.from(this.sources.values()).filter((s) => s.domain === normalized);
  }

  public size(): number {
    return this.sources.size;
  }

  public clear(): void {
    this.sources.clear();
  }
}

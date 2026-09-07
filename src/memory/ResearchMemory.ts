import type { ResearchClaimItem, ResearchSourceItem } from './types.js';

export class ResearchMemory {
  private sources: Map<string, ResearchSourceItem> = new Map();
  private findings: Map<string, ResearchClaimItem> = new Map();
  private sourceCounter = 0;
  private findingCounter = 0;

  public addSource(source: {
    id?: string;
    url: string;
    domain?: string;
    title?: string;
    accessedAt?: string;
    relevance?: number;
  }): ResearchSourceItem {
    // Check if source URL already exists
    const existing = Array.from(this.sources.values()).find((s) => s.url === source.url);
    if (existing) {
      if (source.title && !existing.title) existing.title = source.title;
      if (source.relevance !== undefined) existing.relevance = source.relevance;
      return existing;
    }

    this.sourceCounter++;
    const id = source.id || `src_${String(this.sourceCounter).padStart(3, '0')}`;

    let domain = source.domain;
    if (!domain) {
      try {
        domain = new URL(source.url).hostname;
      } catch {
        domain = 'unknown';
      }
    }

    const item: ResearchSourceItem = {
      id,
      url: source.url,
      domain,
      title: source.title,
      accessedAt: source.accessedAt || new Date().toISOString(),
      relevance: source.relevance,
    };

    this.sources.set(id, item);
    return item;
  }

  public getSource(id: string): ResearchSourceItem | undefined {
    return this.sources.get(id);
  }

  public getSourceByUrl(url: string): ResearchSourceItem | undefined {
    return Array.from(this.sources.values()).find((s) => s.url === url);
  }

  public getSources(): ResearchSourceItem[] {
    return Array.from(this.sources.values());
  }

  public addFinding(finding: {
    id?: string;
    claim: string;
    sourceUrls: string[];
    confidence?: number;
    notes?: string;
    createdAt?: string;
  }): ResearchClaimItem {
    this.findingCounter++;
    const id = finding.id || `find_${String(this.findingCounter).padStart(3, '0')}`;

    const item: ResearchClaimItem = {
      id,
      claim: finding.claim.trim(),
      sourceUrls: [...finding.sourceUrls],
      confidence: finding.confidence ?? 1.0,
      notes: finding.notes,
      createdAt: finding.createdAt || new Date().toISOString(),
    };

    this.findings.set(id, item);
    return item;
  }

  public getFindings(): ResearchClaimItem[] {
    return Array.from(this.findings.values());
  }

  public serialize(): { sources: ResearchSourceItem[]; findings: ResearchClaimItem[] } {
    return {
      sources: Array.from(this.sources.values()),
      findings: Array.from(this.findings.values()),
    };
  }

  public deserialize(data: { sources?: ResearchSourceItem[]; findings?: ResearchClaimItem[] }): void {
    this.sources.clear();
    this.findings.clear();

    if (data.sources) {
      for (const s of data.sources) {
        this.sources.set(s.id, { ...s });
        const num = parseInt(s.id.replace('src_', ''), 10);
        if (!isNaN(num) && num > this.sourceCounter) {
          this.sourceCounter = num;
        }
      }
    }

    if (data.findings) {
      for (const f of data.findings) {
        this.findings.set(f.id, { ...f });
        const num = parseInt(f.id.replace('find_', ''), 10);
        if (!isNaN(num) && num > this.findingCounter) {
          this.findingCounter = num;
        }
      }
    }
  }
}
